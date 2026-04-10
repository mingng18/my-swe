/**
 * MCP configuration types for Bullhorse.
 *
 * Based on the Model Context Protocol specification.
 */

/**
 * Supported transport types for MCP server connections.
 */
export type McpTransportType = "stdio" | "sse" | "http";

/**
 * Base configuration for an MCP server.
 */
export interface McpServerConfig {
  /** Human-readable name for the server */
  displayName?: string;
  /** Transport type (defaults to "stdio" if command is present) */
  type?: McpTransportType;
  /** Environment variables to pass to the server process */
  env?: Record<string, string>;
  /** Whether this server is disabled */
  disabled?: false;
}

/**
 * stdio transport configuration (subprocess).
 */
export interface McpStdioServerConfig extends McpServerConfig {
  /** Command to execute (e.g., "node", "python", "npx") */
  command: string;
  /** Arguments to pass to the command */
  args?: string[];
  /** Transport type is stdio (default when command is present) */
  type?: "stdio";
}

/**
 * SSE (Server-Sent Events) transport configuration.
 */
export interface McpSseServerConfig extends McpServerConfig {
  /** URL of the SSE endpoint */
  url: string;
  /** HTTP headers to include in requests */
  headers?: Record<string, string>;
  /** Transport type is SSE */
  type: "sse";
}

/**
 * HTTP transport configuration.
 */
export interface McpHttpStatusConfig extends McpServerConfig {
  /** URL of the HTTP endpoint */
  url: string;
  /** HTTP headers to include in requests */
  headers?: Record<string, string>;
  /** Transport type is HTTP */
  type: "http";
}

/**
 * Union type for all MCP server configurations.
 */
export type McpScopedServerConfig =
  | McpStdioServerConfig
  | McpSseServerConfig
  | McpHttpStatusConfig;

/**
 * MCP configuration file structure (.agents/mcp.json).
 */
export interface McpConfig {
  /** Map of server name to server configuration */
  servers: Record<string, McpScopedServerConfig>;
}

/**
 * MCP tool metadata.
 */
export interface McpToolMetadata {
  /** Server this tool belongs to */
  serverName: string;
  /** Tool name (from MCP server) */
  name: string;
  /** Tool description */
  description?: string;
  /** JSON Schema for tool input */
  inputSchema?: any;
}

/**
 * MCP resource metadata.
 */
export interface McpResourceMetadata {
  /** Server this resource belongs to */
  serverName: string;
  /** Resource URI */
  uri: string;
  /** Resource name */
  name: string;
  /** Optional description */
  description?: string;
  /** MIME type */
  mimeType?: string;
}

/**
 * MCP client connection state.
 */
export type McpConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/**
 * MCP client wrapper.
 */
export interface McpClient {
  /** Server name */
  name: string;
  /** Connection state */
  state: McpConnectionState;
  /** Underlying MCP client instance */
  client?: any;
  /** Server capabilities */
  capabilities?: any;
  /** Error message if in error state */
  error?: string;
}

/**
 * Options for MCP tool execution.
 */
export interface McpToolExecuteOptions {
  /** Tool name */
  name: string;
  /** Tool arguments (will be validated against input schema) */
  arguments: any;
  /** Timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Result of MCP tool execution.
 */
export interface McpToolResult {
  /** Result content */
  content: any;
  /** Whether the call was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Whether result is truncated */
  isTruncated?: boolean;
}
