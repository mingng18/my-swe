/**
 * List MCP Resources Tool for Bullhorse.
 *
 * Lists available resources from configured MCP servers.
 * Resources are data sources that MCP servers expose (like files, database queries, etc.).
 *
 * Based on the ListMcpResourcesTool pattern from Claude Code, adapted for LangChain/Bullhorse.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createLogger } from "../utils/logger.js";
import { getMcpManager } from "../mcp/client.js";

const logger = createLogger("list-mcp-resources");

/**
 * Tool to list available resources from MCP servers.
 *
 * Usage:
 * - List all resources from all servers: `listMcpResources()`
 * - List resources from a specific server: `listMcpResources({ server: "myserver" })`
 */
export const listMcpResourcesTool = tool(
  async ({ server }, config) => {
    const threadId = config?.configurable?.thread_id;
    const workspaceDir: string = config?.configurable?.repo?.workspaceDir ?? "";

    if (!workspaceDir) {
      return JSON.stringify({
        error: "No workspace directory available. MCP requires a repo context.",
      });
    }

    logger.debug(
      { thread: threadId, workspace: workspaceDir, server },
      "[list-mcp-resources] Listing resources"
    );

    try {
      const mcpManager = getMcpManager(workspaceDir);

      // Ensure connections are established
      await mcpManager.loadConfig();

      const resources = await mcpManager.getAllResources();

      // Filter by server if specified
      const filteredResources = server
        ? resources.filter((r) => r.serverName === server)
        : resources;

      if (server && filteredResources.length === 0) {
        const availableServers = new Set(resources.map((r) => r.serverName));
        return JSON.stringify({
          error: `Server "${server}" not found or has no resources.`,
          availableServers: Array.from(availableServers),
        });
      }

      logger.info(
        {
          thread: threadId,
          total: resources.length,
          filtered: filteredResources.length,
          server,
        },
        "[list-mcp-resources] Resources listed"
      );

      // Format results for the agent
      const formatted = filteredResources.map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
        server: r.serverName,
      }));

      return JSON.stringify({
        resources: formatted,
        total: formatted.length,
        message:
          formatted.length === 0
            ? "No resources found. MCP servers may still provide tools even if they have no resources."
            : undefined,
      });
    } catch (err) {
      logger.error(
        { thread: threadId, err },
        "[list-mcp-resources] Failed to list resources"
      );

      return JSON.stringify({
        error: `Failed to list MCP resources: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  },
  {
    name: "list_mcp_resources",
    description:
      "List available resources from configured MCP servers. Each resource includes a 'server' field indicating which server it's from. Resources are data sources like files, database queries, or API endpoints that MCP servers expose.",
    schema: z.object({
      server: z
        .string()
        .optional()
        .describe("Optional server name to filter resources by"),
    }),
  }
);
