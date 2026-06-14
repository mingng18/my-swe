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

// ---------------------------------------------------------------------------
// Elicitation support (#496)
//
// When an MCP server needs to ask the user a clarifying question mid
// tool-flow, it sends an `elicitation/create` request. The client surfaces the
// question to the active transport and returns the user's answer to the server.
// ---------------------------------------------------------------------------

/** Elicitation modes (form-based or URL-based). */
export type ElicitationMode = "form" | "url";

/** A single property of the requested form schema. */
export interface ElicitationSchemaProperty {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  [key: string]: unknown;
}

/** The form schema an elicitation request asks the client to render. */
export interface ElicitationRequestedSchema {
  type: "object";
  properties: Record<string, ElicitationSchemaProperty>;
  required?: string[];
}

/**
 * The params of an `elicitation/create` request. Only form-mode is surfaced to
 * transports in this implementation; URL mode is recorded for completeness.
 */
export interface ElicitRequestParams {
  /** A human-readable message / clarifying question to present to the user. */
  message: string;
  /** Requested form schema (form mode) — absent for URL mode. */
  requestedSchema?: ElicitationRequestedSchema;
  /** Elicitation mode. Defaults to "form" per the MCP spec. */
  mode?: ElicitationMode;
  /** URL to navigate to (URL mode only). */
  url?: string;
  /** Elicitation id (URL mode only). */
  elicitationId?: string;
}

/** A normalized elicitation request surfaced to transports. */
export interface ElicitRequest {
  /** Server name that issued the elicitation. */
  serverName: string;
  /** Form / clarifying params. */
  params: ElicitRequestParams;
}

/** Actions the user (or client) can take on an elicitation. */
export type ElicitAction = "accept" | "decline" | "cancel";

/**
 * The answer returned to the MCP server. This matches the MCP
 * `ElicitResultSchema` shape ({action, content?}).
 */
export interface ElicitResult {
  action: ElicitAction;
  /** User-supplied form values (only meaningful for action === "accept"). */
  content?: Record<string, string | number | boolean | string[]>;
}

/**
 * Transport-supplied handler that surfaces an elicitation to the user and
 * resolves with their answer. Implementations may reject/throw to signal an
 * internal failure — the caller treats that as a decline, never propagating
 * the error across the async boundary.
 *
 * Returning `undefined` is treated as "decline".
 */
export type ElicitationHandler = (
  request: ElicitRequest,
) => Promise<ElicitResult | undefined | void>;

/**
 * Options for installing an elicitation handler on an MCP client.
 */
export interface McpElicitationOptions {
  /** Handler that surfaces the question to the transport. */
  handler: ElicitationHandler;
  /** Per-elicitation timeout in ms. Default 30000. */
  timeoutMs?: number;
}
