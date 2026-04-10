/**
 * MCP Client Service for Bullhorse.
 *
 * Manages connections to MCP servers configured in .agents/mcp.json.
 * Handles stdio, SSE, and HTTP transports.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  McpClient,
  McpConfig,
  McpScopedServerConfig,
  McpConnectionState,
  McpToolExecuteOptions,
  McpToolResult,
} from "./types.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("mcp-client");

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Expand environment variables in a string.
 * Supports ${VAR_NAME} syntax.
 */
function expandEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    return process.env[varName] || "";
  });
}

/**
 * Expand environment variables in all strings of an object.
 */
function expandEnvVarsRecursive(obj: any): any {
  if (typeof obj === "string") {
    return expandEnvVars(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(expandEnvVarsRecursive);
  }
  if (obj && typeof obj === "object") {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandEnvVarsRecursive(value);
    }
    return result;
  }
  return obj;
}

/**
 * MCP Client Manager.
 *
 * Manages lifecycle of MCP server connections and provides
 * methods to call tools and read resources.
 */
export class McpClientManager {
  private clients: Map<string, McpClient> = new Map();
  private config: McpConfig | null = null;
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Load MCP configuration from .agents/mcp.json in the workspace.
   */
  async loadConfig(): Promise<void> {
    const fs = await import("fs/promises");
    const path = await import("path");

    const configPath = path.join(this.workspaceRoot, ".agents", "mcp.json");

    try {
      const content = await fs.readFile(configPath, "utf-8");
      this.config = JSON.parse(content);

      // Expand environment variables
      this.config = expandEnvVarsRecursive(this.config);

      if (!this.config) {
        this.config = { servers: {} };
      }

      logger.info(
        { serverCount: Object.keys(this.config.servers).length },
        "[mcp-client] Loaded MCP configuration",
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        logger.debug("[mcp-client] No .agents/mcp.json found, MCP disabled");
        this.config = { servers: {} };
      } else {
        logger.error({ err }, "[mcp-client] Failed to load MCP config");
        this.config = { servers: {} };
      }
    }
  }

  /**
   * Connect to all configured MCP servers.
   */
  async connectAll(): Promise<void> {
    if (!this.config) {
      await this.loadConfig();
    }

    const connectionPromises: Promise<void>[] = [];

    for (const [name, serverConfig] of Object.entries(
      this.config?.servers || {},
    )) {
      if (serverConfig.disabled) {
        logger.debug(
          { server: name },
          "[mcp-client] Server disabled, skipping",
        );
        continue;
      }

      connectionPromises.push(
        this.connectServer(name, serverConfig).catch((err) => {
          logger.warn(
            { server: name, err },
            "[mcp-client] Failed to connect to server",
          );
        }),
      );
    }

    await Promise.all(connectionPromises);

    const connectedCount = Array.from(this.clients.values()).filter(
      (c) => c.state === "connected",
    ).length;

    logger.info(
      { total: this.clients.size, connected: connectedCount },
      "[mcp-client] Connection complete",
    );
  }

  /**
   * Connect to a single MCP server.
   */
  private async connectServer(
    name: string,
    config: McpScopedServerConfig,
  ): Promise<void> {
    logger.info(
      { server: name, type: config.type },
      "[mcp-client] Connecting...",
    );

    // Initialize client entry
    this.clients.set(name, {
      name,
      state: "connecting",
    });

    try {
      const client = new Client(
        {
          name: `bullhorse-${name}`,
          version: "1.0.0",
        },
        {
          capabilities: {},
        },
      );

      let transport: any;

      if (config.type === "sse") {
        transport = new SSEClientTransport(new URL(config.url));
      } else if (config.type === "http") {
        // HTTP uses SSE transport under the hood
        transport = new SSEClientTransport(new URL(config.url));
      } else {
        // stdio is default
        // Merge process.env with config.env, filtering out undefined values
        const env: Record<string, string> = {
          ...(config.env || {}),
        };

        // Add process.env values that are defined strings
        for (const [key, value] of Object.entries(process.env)) {
          if (typeof value === "string") {
            env[key] = value;
          }
        }

        transport = new StdioClientTransport({
          command: config.command,
          args: config.args || [],
          env,
        });
      }

      await client.connect(transport);

      const mcpClient: McpClient = {
        name,
        state: "connected",
        client,
        capabilities: client.getServerCapabilities(),
      };

      this.clients.set(name, mcpClient);

      logger.info(
        { server: name, capabilities: mcpClient.capabilities },
        "[mcp-client] Connected",
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.clients.set(name, {
        name,
        state: "error",
        error: errorMsg,
      });

      logger.error({ server: name, err }, "[mcp-client] Connection failed");
      throw err;
    }
  }

  /**
   * Get all connected clients.
   */
  getConnectedClients(): McpClient[] {
    return Array.from(this.clients.values()).filter(
      (c) => c.state === "connected",
    );
  }

  /**
   * Get a client by name.
   */
  getClient(name: string): McpClient | undefined {
    return this.clients.get(name);
  }

  /**
   * Get all available tools from all connected servers.
   */
  async getAllTools(): Promise<any[]> {
    const tools: any[] = [];

    for (const client of this.getConnectedClients()) {
      try {
        const response = await client.client?.listTools();
        if (response?.tools) {
          for (const tool of response.tools) {
            tools.push({
              ...tool,
              serverName: client.name,
            });
          }
        }
      } catch (err) {
        logger.warn(
          { server: client.name, err },
          "[mcp-client] Failed to list tools",
        );
      }
    }

    return tools;
  }

  /**
   * Get all available resources from all connected servers.
   */
  async getAllResources(): Promise<any[]> {
    const resources: any[] = [];

    for (const client of this.getConnectedClients()) {
      try {
        const response = await client.client?.listResources();
        if (response?.resources) {
          for (const resource of response.resources) {
            resources.push({
              ...resource,
              serverName: client.name,
            });
          }
        }
      } catch (err) {
        logger.warn(
          { server: client.name, err },
          "[mcp-client] Failed to list resources",
        );
      }
    }

    return resources;
  }

  /**
   * Execute a tool on an MCP server.
   */
  async executeTool(
    serverName: string,
    options: McpToolExecuteOptions,
  ): Promise<McpToolResult> {
    const client = this.getClient(serverName);

    if (!client) {
      return {
        content: null,
        success: false,
        error: `Server "${serverName}" not found`,
      };
    }

    if (client.state !== "connected") {
      return {
        content: null,
        success: false,
        error: `Server "${serverName}" is not connected (state: ${client.state})`,
      };
    }

    if (!client.capabilities?.tools) {
      return {
        content: null,
        success: false,
        error: `Server "${serverName}" does not support tools`,
      };
    }

    try {
      const result = await Promise.race([
        client.client?.callTool({
          name: options.name,
          arguments: options.arguments,
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Tool execution timeout")),
            options.timeoutMs || DEFAULT_TIMEOUT_MS,
          ),
        ),
      ]);

      return {
        content: result,
        success: true,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      return {
        content: null,
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Read a resource from an MCP server.
   */
  async readResource(serverName: string, uri: string): Promise<McpToolResult> {
    const client = this.getClient(serverName);

    if (!client) {
      return {
        content: null,
        success: false,
        error: `Server "${serverName}" not found`,
      };
    }

    if (client.state !== "connected") {
      return {
        content: null,
        success: false,
        error: `Server "${serverName}" is not connected (state: ${client.state})`,
      };
    }

    if (!client.capabilities?.resources) {
      return {
        content: null,
        success: false,
        error: `Server "${serverName}" does not support resources`,
      };
    }

    try {
      const result = await Promise.race([
        client.client?.readResource({ uri }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Resource read timeout")),
            DEFAULT_TIMEOUT_MS,
          ),
        ),
      ]);

      return {
        content: result,
        success: true,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      return {
        content: null,
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Disconnect all clients.
   */
  async disconnectAll(): Promise<void> {
    const disconnectPromises: Promise<void>[] = [];

    for (const client of this.clients.values()) {
      if (client.client) {
        disconnectPromises.push(
          client.client.close().catch((err: any) => {
            logger.warn(
              { server: client.name, err },
              "[mcp-client] Error during disconnect",
            );
          }),
        );
      }
    }

    await Promise.all(disconnectPromises);
    this.clients.clear();

    logger.info("[mcp-client] All clients disconnected");
  }
}

/**
 * Global registry of MCP client managers per workspace.
 */
const mcpManagerRegistry = new Map<string, McpClientManager>();

/**
 * Get or create an MCP client manager for a workspace.
 */
export function getMcpManager(workspaceRoot: string): McpClientManager {
  let manager = mcpManagerRegistry.get(workspaceRoot);

  if (!manager) {
    manager = new McpClientManager(workspaceRoot);
    mcpManagerRegistry.set(workspaceRoot, manager);
  }

  return manager;
}

/**
 * Clean up an MCP client manager for a workspace.
 */
export async function cleanupMcpManager(workspaceRoot: string): Promise<void> {
  const manager = mcpManagerRegistry.get(workspaceRoot);

  if (manager) {
    await manager.disconnectAll();
    mcpManagerRegistry.delete(workspaceRoot);
  }
}
