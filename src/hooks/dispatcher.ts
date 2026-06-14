/**
 * Event-driven hooks: dispatcher.
 *
 * The dispatcher is the single entry point the rest of the codebase uses to
 * fire events. It owns:
 *
 *   - a `HooksRegistry` (the configured handlers)
 *   - the SessionStart idempotency set (one fire per thread_id)
 *   - the `createHooksMiddleware()` factory that composes into the existing
 *     DeepAgents middleware pipeline (it does NOT replace any middleware)
 *
 * The three emitted events:
 *   - SessionStart : fires once per thread_id (idempotent)
 *   - PreToolUse   : fires before each tool call; may VETO the call
 *   - PostToolUse  : fires after each tool call with the result
 */

import { createMiddleware } from "langchain";
import { ToolMessage } from "@langchain/core/messages";
import { randomUUID } from "node:crypto";
import { createLogger } from "../utils/logger";
import { HooksRegistry, isHookVeto, type McpToolCaller } from "./registry";
import { loadHooksConfig } from "./config";
import type {
  HookEventPayload,
  HooksConfig,
  HookVeto,
  SessionStartPayload,
  ToolEventPayload,
} from "./types";

const logger = createLogger("hooks-dispatcher");

/**
 * The hooks dispatcher. Construct one per process; SessionStart idempotency is
 * tracked internally by thread_id.
 */
export class HooksDispatcher {
  private readonly registry: HooksRegistry;
  private readonly config: HooksConfig;
  /** Set of thread_ids for which SessionStart has already fired. */
  private readonly sessionStarted = new Set<string>();

  constructor(config?: HooksConfig, mcpCaller?: McpToolCaller) {
    this.config = config ?? loadHooksConfig();
    this.registry = new HooksRegistry(this.config, mcpCaller);
  }

  /** Whether hooks are effectively enabled (config enabled AND has handlers). */
  get enabled(): boolean {
    return this.config.enabled !== false && !this.registry.isEmpty;
  }

  /** The agent_id used in event payloads. */
  get agentId(): string {
    return this.config.agent_id ?? "bullhorse";
  }

  /** The agent_type used in event payloads. */
  get agentType(): string {
    return this.config.agent_type ?? "deepagents";
  }

  /**
   * Fire SessionStart. Idempotent per thread_id: the first call for a given
   * thread_id runs the handlers; subsequent calls are no-ops.
   *
   * @returns true if handlers actually ran this call, false if skipped.
   */
  async dispatchSessionStart(threadId: string): Promise<boolean> {
    if (!this.enabled) return false;
    if (this.sessionStarted.has(threadId)) {
      logger.debug({ threadId }, "[hooks] SessionStart already fired for thread");
      return false;
    }
    this.sessionStarted.add(threadId);

    const payload: SessionStartPayload = {
      agent_id: this.agentId,
      agent_type: this.agentType,
      thread_id: threadId,
    };

    const handlers = this.registry.selectHandlers("SessionStart");
    logger.debug({ threadId, count: handlers.length }, "[hooks] firing SessionStart");
    await Promise.all(
      handlers.map((h) => this.registry.runHandler(h, payload)),
    );
    return true;
  }

  /**
   * Fire PreToolUse. If ANY handler returns a veto, the call is skipped and the
   * veto reason is returned (to be surfaced to the agent as the tool result).
   *
   * @returns a veto if the call should be skipped, or null to allow.
   */
  async dispatchPreToolUse(payload: ToolEventPayload): Promise<HookVeto | null> {
    if (!this.enabled) return null;
    const handlers = this.registry.selectHandlers("PreToolUse", payload.tool);
    if (handlers.length === 0) return null;

    const outcomes = await Promise.all(
      handlers.map((h) => this.registry.runHandler(h, payload)),
    );
    const veto = outcomes.find(isHookVeto);
    if (veto) {
      logger.info(
        { tool: payload.tool, name: veto, threadId: payload.thread_id },
        "[hooks] PreToolUse vetoed tool call",
      );
      return veto;
    }
    return null;
  }

  /**
   * Fire PostToolUse with the tool result. Handlers are observers; their
   * outcomes are ignored (PostToolUse cannot veto).
   */
  async dispatchPostToolUse(
    payload: ToolEventPayload & { result?: unknown },
  ): Promise<void> {
    if (!this.enabled) return;
    const handlers = this.registry.selectHandlers("PostToolUse", payload.tool);
    if (handlers.length === 0) return;
    await Promise.all(
      handlers.map((h) => this.registry.runHandler(h, payload)),
    );
  }

  /**
   * Forget the SessionStart marker for a thread_id. Primarily for tests; in
   * production a thread_id maps 1:1 to one session.
   */
  forgetSession(threadId: string): void {
    this.sessionStarted.delete(threadId);
  }
}

/**
 * A lazily-initialized process-wide dispatcher. The first call to
 * `getHooksDispatcher()` loads the config; subsequent calls reuse the instance.
 */
let _dispatcher: HooksDispatcher | null = null;

export function getHooksDispatcher(): HooksDispatcher {
  if (!_dispatcher) {
    _dispatcher = new HooksDispatcher();
  }
  return _dispatcher;
}

/**
 * Reset the process-wide dispatcher (primarily for tests). The next
 * `getHooksDispatcher()` call re-loads the config.
 */
export function resetHooksDispatcher(): void {
  _dispatcher = null;
}

/**
 * Build a DeepAgents-compatible middleware that wires the hooks dispatcher
 * into the tool-call path. This COMPOSES with the existing middleware pipeline
 * — it is appended in `buildMiddleware()` and does not replace anything.
 *
 * When no hooks are configured (dispatcher disabled) the middleware is a
 * pure passthrough.
 */
export function createHooksMiddleware(
  dispatcher: HooksDispatcher = getHooksDispatcher(),
) {
  return createMiddleware({
    name: "hooksMiddleware",

    wrapToolCall: async (request: any, handler: any) => {
      // Passthrough when hooks are not configured.
      if (!dispatcher.enabled) {
        return handler(request);
      }

      const toolName: string = request?.tool?.name ?? request?.toolCall?.name ?? "unknown";
      const toolArgs: Record<string, unknown> =
        (request?.toolCall?.args as Record<string, unknown>) ?? {};
      const toolCallId: string = request?.toolCall?.id ?? randomUUID();
      const threadId: string | undefined = request?.state?.thread_id;

      const toolPayload: ToolEventPayload = {
        agent_id: dispatcher.agentId,
        agent_type: dispatcher.agentType,
        tool: toolName,
        args: toolArgs,
        thread_id: threadId,
      };

      // PreToolUse: allow handlers to veto.
      const veto = await dispatcher.dispatchPreToolUse(toolPayload);
      if (veto) {
        return new ToolMessage({
          content: `[hooks] tool call '${toolName}' vetoed: ${veto.reason}`,
          tool_call_id: toolCallId,
        });
      }

      // Run the actual tool.
      const result = await handler(request);

      // Best-effort PostToolUse. Extract a plain result for the payload; never
      // let a handler failure interfere with the returned ToolMessage.
      let resultValue: unknown;
      try {
        resultValue =
          typeof result?.content === "string"
            ? result.content
            : result?.content?.[0]?.text ?? result;
      } catch {
        resultValue = undefined;
      }
      try {
        await dispatcher.dispatchPostToolUse({
          ...toolPayload,
          result: resultValue,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.warn({ err: errorMsg }, "[hooks] PostToolUse dispatch failed");
      }

      return result;
    },
  });
}

/**
 * Convenience helper for the harness: fire SessionStart if hooks are enabled.
 * Safe to call from any transport entry point.
 */
export async function fireSessionStart(threadId: string): Promise<boolean> {
  const dispatcher = getHooksDispatcher();
  if (!dispatcher.enabled) return false;
  return dispatcher.dispatchSessionStart(threadId);
}
