/**
 * Event-driven hooks: core type definitions.
 *
 * A "hook" is a user-configured handler that runs in response to a lifecycle
 * event during an agent turn. Handlers can be either a shell command or an
 * MCP tool invocation. `PreToolUse` handlers may VETO (block) a tool call.
 *
 * The dispatcher is composed into the existing middleware pipeline via
 * `createHooksMiddleware()` (see `dispatcher.ts`); it does NOT replace any
 * existing middleware.
 */

/** The three lifecycle events emitted by the hooks system. */
export type HookEvent = "SessionStart" | "PreToolUse" | "PostToolUse";

/**
 * Common payload fields carried by every event.
 *
 * `tool` and `args` are populated for `PreToolUse`/`PostToolUse`; they are
 * omitted (undefined) for `SessionStart`. `result` is only present on
 * `PostToolUse`.
 */
export interface HookEventPayload {
  /** The agent instance identifier (e.g. the harness agent id). */
  agent_id: string;
  /** The agent type / provider name (e.g. "deepagents", "opencode"). */
  agent_type: string;
  /** The tool name. Omitted for `SessionStart`. */
  tool?: string;
  /** The arguments passed to the tool. Omitted for `SessionStart`. */
  args?: Record<string, unknown>;
  /** The tool result. Only present for `PostToolUse`. */
  result?: unknown;
  /** The thread id this event belongs to. */
  thread_id?: string;
}

/** Payload for the SessionStart event (fires once per thread). */
export interface SessionStartPayload extends HookEventPayload {
  tool?: undefined;
  args?: undefined;
  result?: undefined;
}

/** Payload for PreToolUse / PostToolUse events. */
export interface ToolEventPayload extends HookEventPayload {
  tool: string;
  args: Record<string, unknown>;
}

/**
 * A structured veto returned by a `PreToolUse` handler to block a tool call.
 * When any PreToolUse handler returns a veto, the tool call is skipped and the
 * veto reason is surfaced to the agent as the tool result.
 */
export interface HookVeto {
  /** Marker that this is a veto (discriminant). */
  veto: true;
  /** Human-readable reason the call was blocked. Surfaced to the agent. */
  reason: string;
}

/** The outcome a handler returns. `void`/`undefined` means "no opinion". */
export type HookHandlerOutcome = HookVeto | void | undefined | null;

/**
 * A handler implemented as a shell command. The command is executed with the
 * event payload serialized as JSON on stdin (and the fields as `HOOK_*` env
 * vars). A non-zero exit code from a `PreToolUse` shell handler is treated as
 * a veto whose reason is the command's stderr.
 */
export interface ShellHandlerConfig {
  type: "shell";
  /** The command line to execute (passed through a shell). */
  command: string;
  /** Optional working directory. Defaults to process cwd. */
  cwd?: string;
  /** Optional environment variables to set for the command. */
  env?: Record<string, string>;
}

/**
 * A handler implemented as an MCP tool call. The dispatcher invokes the named
 * MCP tool with the event payload merged into the arguments.
 */
export interface McpToolHandlerConfig {
  type: "mcp_tool";
  /** The MCP server name (as registered in the MCP config). */
  server: string;
  /** The MCP tool name to invoke. */
  tool: string;
  /** Extra arguments to merge into the tool call. */
  args?: Record<string, unknown>;
}

/** A single configured handler for an event. */
export type HookHandlerConfig = ShellHandlerConfig | McpToolHandlerConfig;

/**
 * A configured handler entry, bound to one or more events.
 *
 * `tools` optionally restricts a handler to a subset of tool names (only
 * meaningful for `PreToolUse`/`PostToolUse`); an empty/missing list means
 * "all tools".
 */
export interface HookEntry {
  /** Display name for the handler, used in logs. */
  name: string;
  /** One or more events this handler listens to. */
  events: HookEvent[];
  /** Tool names this handler applies to (empty = all). Ignored for SessionStart. */
  tools?: string[];
  /** Whether the handler is active. Defaults to true. */
  enabled?: boolean;
  /** The handler implementation. */
  handler: HookHandlerConfig;
}

/** The full hooks configuration document. */
export interface HooksConfig {
  /** Globally enable/disable the hooks system. Defaults to true. */
  enabled?: boolean;
  /** The agent id used in event payloads. Defaults to "bullhorse". */
  agent_id?: string;
  /** The agent type used in event payloads. Defaults to "deepagents". */
  agent_type?: string;
  /** The list of handler entries. */
  handlers: HookEntry[];
}
