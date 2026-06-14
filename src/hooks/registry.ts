/**
 * Event-driven hooks: registry.
 *
 * The registry owns the list of configured handlers and is responsible for:
 *   - selecting the handlers that apply to a given (event, tool) pair
 *   - executing a handler (shell command or MCP tool call)
 *
 * Handler execution is best-effort and isolated: a failure in one handler is
 * logged and does NOT abort the others or the agent turn. This matches the
 * "hooks are observers, not control flow" principle, except for the explicit
 * PreToolUse veto contract.
 */

import { spawn } from "node:child_process";
import { createLogger } from "../utils/logger";
import type {
  HookEntry,
  HookEvent,
  HookEventPayload,
  HookHandlerOutcome,
  HookVeto,
  McpToolHandlerConfig,
  ShellHandlerConfig,
} from "./types";
import type { HooksConfig } from "./types";

const logger = createLogger("hooks-registry");

/**
 * Function used to invoke an MCP tool. Injected so tests can stub it without a
 * live MCP server. The real implementation is wired in `dispatcher.ts`.
 */
export type McpToolCaller = (
  server: string,
  tool: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

/** A no-op MCP caller used when none is configured. */
const noopMcpCaller: McpToolCaller = async () => undefined;

/**
 * The hooks registry. Holds the validated config and dispatches events to the
 * applicable handlers.
 */
export class HooksRegistry {
  private readonly handlers: HookEntry[];
  private readonly mcpCaller: McpToolCaller;

  constructor(config: HooksConfig, mcpCaller: McpToolCaller = noopMcpCaller) {
    // Only keep enabled handlers up front.
    this.handlers = config.handlers.filter((h) => h.enabled !== false);
    this.mcpCaller = mcpCaller;
  }

  /** Whether the registry has any handlers at all. */
  get isEmpty(): boolean {
    return this.handlers.length === 0;
  }

  /**
   * Return the handlers that apply to a given event (and optional tool name).
   * Tool filtering only applies to PreToolUse/PostToolUse.
   */
  selectHandlers(event: HookEvent, tool?: string): HookEntry[] {
    return this.handlers.filter((entry) => {
      if (!entry.events.includes(event)) return false;
      if (event === "SessionStart") return true;
      // Tool-scoped handler: empty/missing tools list means "all tools".
      if (!entry.tools || entry.tools.length === 0) return true;
      return tool !== undefined && entry.tools.includes(tool);
    });
  }

  /**
   * Execute a single handler for a payload. Returns the handler's outcome
   * (possibly a veto). Never throws — failures are logged and swallowed.
   */
  async runHandler(
    entry: HookEntry,
    payload: HookEventPayload,
  ): Promise<HookHandlerOutcome> {
    try {
      if (entry.handler.type === "shell") {
        return await this.runShell(entry.handler, payload);
      }
      return await this.runMcpTool(entry.handler, payload);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { name: entry.name, err: errorMsg },
        "[hooks-registry] handler failed",
      );
      return undefined;
    }
  }

  /**
   * Run a shell handler. The payload is passed as JSON on stdin and as `HOOK_*`
   * env vars. For PreToolUse, a non-zero exit code is treated as a veto.
   */
  private async runShell(
    handler: ShellHandlerConfig,
    payload: HookEventPayload,
  ): Promise<HookHandlerOutcome> {
    const stdin = JSON.stringify(payload);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(handler.env ?? {}),
      HOOK_AGENT_ID: payload.agent_id,
      HOOK_AGENT_TYPE: payload.agent_type,
      HOOK_TOOL: payload.tool ?? "",
      HOOK_THREAD_ID: payload.thread_id ?? "",
    };

    const result = await new Promise<{ code: number; stdout: string; stderr: string }>(
      (resolve) => {
        const child = spawn(handler.command, {
          shell: true,
          cwd: handler.cwd,
          env,
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout += d.toString()));
        child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("error", (err) =>
          resolve({ code: 1, stdout, stderr: err.message }),
        );
        child.on("close", (code) =>
          resolve({ code: code ?? 0, stdout, stderr }),
        );
        child.stdin.end(stdin);
      },
    );

    if (result.code !== 0) {
      const reason =
        result.stderr.trim() ||
        `shell handler '${handler.command}' exited ${result.code}`;
      // A non-zero exit is only a veto for PreToolUse events.
      if (payload.tool !== undefined) {
        return { veto: true, reason };
      }
      logger.warn(
        { command: handler.command, code: result.code, stderr: result.stderr.trim() },
        "[hooks-registry] shell handler exited non-zero",
      );
    }
    return undefined;
  }

  /**
   * Run an MCP tool handler. The payload is merged with any extra args. The
   * MCP tool may return a veto object directly.
   */
  private async runMcpTool(
    handler: McpToolHandlerConfig,
    payload: HookEventPayload,
  ): Promise<HookHandlerOutcome> {
    const args = { ...(handler.args ?? {}), ...payload };
    const response = await this.mcpCaller(handler.server, handler.tool, args);

    if (response && typeof response === "object") {
      const maybe = response as { veto?: unknown; reason?: unknown };
      if (maybe.veto === true && typeof maybe.reason === "string") {
        return { veto: true, reason: maybe.reason };
      }
    }
    return undefined;
  }
}

/** Type guard for the structured veto contract. */
export function isHookVeto(value: HookHandlerOutcome): value is HookVeto {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === "object" &&
    (value as HookVeto).veto === true &&
    typeof (value as HookVeto).reason === "string"
  );
}
