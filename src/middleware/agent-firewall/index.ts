/**
 * Agent Firewall middleware for DeepAgents.
 *
 * Wraps each tool call with three layers of guardrails:
 *  1. Command/shell denylist + optional allowlist (FIREWALL_COMMAND_DENY /
 *     FIREWALL_COMMAND_ALLOW). Denied commands are blocked + logged, never
 *     executed.
 *  2. Network host-glob allowlist (FIREWALL_NETWORK_ALLOW). Non-allowlisted
 *     fetch/url targets are blocked.
 *  3. Hard kill-switch: a per-thread call ceiling
 *     (FIREWALL_MAX_CALLS_PER_THREAD) plus the shared cost/token budget
 *     (MAX_COST_PER_THREAD). On breach the middleware raises a typed
 *     {@link FirewallViolationError} to abort the turn.
 *
 * When no firewall env vars are set, {@link loadFirewallConfig} reports the
 * firewall as disabled and this middleware becomes a pass-through, so existing
 * tests stay green.
 *
 * Pass to `createDeepAgent({ middleware: [createAgentFirewallMiddleware()] })`.
 */

import { ToolMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";
import { createLogger } from "../../utils/logger";
import { loadFirewallConfig } from "./config";
import {
  enforceBudget,
  incrementThreadCallCount,
  inspectToolCall,
} from "./engine";
import { FirewallViolationError } from "./types";

const logger = createLogger("agent-firewall");

/**
 * Resolve a thread id from the middleware runtime state. The DeepAgents
 * runtime exposes `config.configurable.thread_id`; fall back to "default"
 * when unavailable so the firewall still enforces in unit contexts.
 */
function resolveThreadId(state: Record<string, unknown>): string {
  const configurable = state?.configurable as
    | { thread_id?: string }
    | undefined;
  if (configurable?.thread_id) return configurable.thread_id;
  if (typeof state?.thread_id === "string") return state.thread_id as string;
  return "default";
}

/**
 * Build a ToolMessage that reports a firewall block back to the agent, so the
 * agent sees the denial in its tool-result stream rather than crashing.
 */
function blockedToolMessage(
  toolCallId: string,
  toolName: string,
  reason: string,
): ToolMessage {
  const content =
    `[agent-firewall] BLOCKED tool \`${toolName}\`: ${reason}\n\n` +
    "The Agent Firewall prevented this call. Adjust your approach and try an " +
    "alternative that does not trip the firewall rules.";
  return new ToolMessage({
    tool_call_id: toolCallId,
    content,
    name: toolName,
  });
}

/**
 * Create the DeepAgents-compatible firewall middleware.
 */
export function createAgentFirewallMiddleware() {
  const config = loadFirewallConfig();

  return createMiddleware({
    name: "agentFirewallMiddleware",

    wrapToolCall: async (request: any, handler: any) => {
      // Pass-through when no rules are configured.
      if (!config.enabled) {
        return handler(request);
      }

      const toolCall = request?.toolCall;
      const toolName: string = toolCall?.name ?? "unknown";
      const args: Record<string, unknown> =
        (toolCall?.args as Record<string, unknown>) ?? {};
      const toolCallId: string = toolCall?.id ?? "";
      const threadId = resolveThreadId(request?.runtime ?? request?.state ?? {});

      // Hard kill-switch: abort the turn on budget breach. The typed error
      // propagates up to the agent driver, which surfaces it as a turn failure.
      try {
        enforceBudget(threadId, config);
      } catch (err) {
        if (err instanceof FirewallViolationError) {
          logger.error(
            { threadId, toolName, reason: err.reason },
            "[agent-firewall] Kill-switch tripped — aborting turn",
          );
        }
        throw err;
      }

      // Count this call toward the per-thread ceiling (after the budget check
      // so the first call at the limit still trips before execution).
      incrementThreadCallCount(threadId);

      // Inspect the call against command/network rules.
      const check = inspectToolCall(toolName, args, config);
      if (check.block) {
        logger.warn(
          { threadId, toolName, rule: check.rule, reason: check.reason },
          "[agent-firewall] Blocked tool call",
        );
        return blockedToolMessage(toolCallId, toolName, check.reason ?? "blocked");
      }

      return handler(request);
    },
  });
}

export { loadFirewallConfig, resetFirewallConfig } from "./config";
export {
  checkCommand,
  checkNetwork,
  clearThreadCallCount,
  enforceBudget,
  getThreadCallCount,
  hostGlobToRegExp,
  incrementThreadCallCount,
  inspectToolCall,
  isCommandTool,
  isNetworkTool,
  resetThreadCallCounts,
} from "./engine";
export { FirewallViolationError } from "./types";
export type { FirewallCheck, FirewallConfig } from "./types";
