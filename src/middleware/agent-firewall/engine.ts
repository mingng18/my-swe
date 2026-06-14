/**
 * Agent Firewall inspection engine.
 *
 * Pure functions that decide whether a tool call should be blocked, plus a
 * small per-thread call counter that backs the hard kill-switch. These are
 * decoupled from the langchain middleware glue so they can be unit-tested in
 * isolation.
 */

import { createLogger } from "../../utils/logger";
import { checkBudget } from "../../utils/token-tracker";
import type { FirewallCheck, FirewallConfig } from "./types";
import { FirewallViolationError } from "./types";

const logger = createLogger("agent-firewall");

/**
 * Argument keys that typically carry a shell/command string. Order is loose:
 * the firewall concatenates every string-valued arg so the rule applies even
 * if a tool uses an unusual key.
 */
const COMMAND_ARG_KEYS = [
  "command",
  "cmd",
  "shell",
  "script",
  "exec",
  "args",
] as const;

/**
 * Argument keys that typically carry a URL / network target.
 */
const URL_ARG_KEYS = ["url", "uri", "endpoint", "host", "fetch_url"] as const;

/**
 * Tool names that are treated as command/shell executors when their arg keys
 * don't match the allowlist above. Anything containing these substrings is
 * considered a shell tool.
 */
const SHELL_TOOL_HINTS = ["shell", "exec", "bash", "run_command", "terminal"];

/**
 * Tool names that are treated as network/fetch tools.
 */
const NETWORK_TOOL_HINTS = ["fetch", "url", "http", "curl", "wget", "request"];

/**
 * Collect every string value reachable in a tool-args object (shallow, plus a
 * single level of array values). Returns the concatenated blob used for regex
 * matching and the list of individual values for URL extraction.
 */
function collectStringValues(args: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of Object.keys(args)) {
    const val = args[key];
    if (typeof val === "string") {
      out.push(val);
    } else if (Array.isArray(val)) {
      for (const v of val) {
        if (typeof v === "string") out.push(v);
      }
    }
  }
  return out;
}

/**
 * Extract the command blob to inspect. Prefers well-known command arg keys,
 * falling back to the concatenation of all string values.
 */
function extractCommand(
  args: Record<string, unknown>,
): string {
  for (const key of COMMAND_ARG_KEYS) {
    const val = args[key];
    if (typeof val === "string" && val.length > 0) return val;
  }
  return collectStringValues(args).join(" ");
}

/**
 * Extract URL-like targets from args. Prefers well-known url arg keys, then
 * falls back to scanning all string values for things that parse as URLs.
 */
function extractUrls(args: Record<string, unknown>): string[] {
  const urls: string[] = [];
  for (const key of URL_ARG_KEYS) {
    const val = args[key];
    if (typeof val === "string" && val.length > 0) {
      urls.push(val);
    }
  }
  // Fall back to scanning all string values for URL-like content.
  if (urls.length === 0) {
    for (const val of collectStringValues(args)) {
      if (/^https?:\/\//i.test(val)) urls.push(val);
    }
  }
  return urls;
}

/**
 * Convert a host glob (e.g. `*.example.com`, `api.github.com`) into a RegExp.
 * Escapes regex metacharacters except `*`, which becomes `.*`.
 */
export function hostGlobToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

/**
 * Parse the host out of a URL string, returning null if it isn't a URL.
 */
function urlHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Decide whether a tool is a command/shell tool. True if the name hints at a
 * shell tool OR the args contain one of the well-known command keys.
 */
export function isCommandTool(
  toolName: string,
  args: Record<string, unknown>,
): boolean {
  const name = toolName.toLowerCase();
  if (SHELL_TOOL_HINTS.some((h) => name.includes(h))) return true;
  return COMMAND_ARG_KEYS.some((k) => typeof args[k] === "string");
}

/**
 * Decide whether a tool is a network/fetch tool. True if the name hints at a
 * network tool OR the args contain a URL-like value under a known key.
 */
export function isNetworkTool(
  toolName: string,
  args: Record<string, unknown>,
): boolean {
  const name = toolName.toLowerCase();
  if (NETWORK_TOOL_HINTS.some((h) => name.includes(h))) return true;
  return URL_ARG_KEYS.some((k) => typeof args[k] === "string");
}

/**
 * Inspect a command/shell tool call against the denylist + allowlist.
 */
export function checkCommand(
  command: string,
  config: FirewallConfig,
): FirewallCheck {
  // Denylist wins: any match blocks regardless of allowlist.
  for (const deny of config.commandDeny) {
    if (deny.test(command)) {
      return {
        block: true,
        rule: "command_denied",
        reason: `Command denied by firewall pattern "${deny.source}": ${command}`,
      };
    }
  }

  // If an allowlist is configured, the command must match at least one entry.
  if (config.commandAllow.length > 0) {
    const allowed = config.commandAllow.some((re) => re.test(command));
    if (!allowed) {
      return {
        block: true,
        rule: "command_denied",
        reason: `Command not on allowlist: ${command}`,
      };
    }
  }

  return { block: false };
}

/**
 * Inspect a network/fetch tool call against the host-glob allowlist.
 */
export function checkNetwork(
  urls: string[],
  config: FirewallConfig,
): FirewallCheck {
  if (config.networkAllow.length === 0) {
    return { block: false };
  }

  const allowRe = config.networkAllow.map(hostGlobToRegExp);

  for (const raw of urls) {
    const host = urlHost(raw);
    if (host === null) {
      // Not a URL — skip. Non-URL args are not network targets.
      continue;
    }
    const allowed = allowRe.some((re) => re.test(host));
    if (!allowed) {
      return {
        block: true,
        rule: "network_denied",
        reason: `Network host not on allowlist: ${host} (from ${raw})`,
      };
    }
  }

  return { block: false };
}

/**
 * Inspect a single tool call against all applicable firewall rules.
 */
export function inspectToolCall(
  toolName: string,
  args: Record<string, unknown>,
  config: FirewallConfig,
): FirewallCheck {
  if (!config.enabled) return { block: false };

  if (isCommandTool(toolName, args)) {
    const command = extractCommand(args);
    if (command.length > 0) {
      const result = checkCommand(command, config);
      if (result.block) return result;
    }
  }

  if (isNetworkTool(toolName, args)) {
    const urls = extractUrls(args);
    if (urls.length > 0) {
      const result = checkNetwork(urls, config);
      if (result.block) return result;
    }
  }

  return { block: false };
}

// ============================================================================
// Per-thread call counter (hard kill-switch backing store)
// ============================================================================

const threadCallCounts = new Map<string, number>();

/**
 * Get the recorded tool-call count for a thread.
 */
export function getThreadCallCount(threadId: string): number {
  return threadCallCounts.get(threadId) || 0;
}

/**
 * Increment (and return) the per-thread call count.
 */
export function incrementThreadCallCount(threadId: string): number {
  const next = (threadCallCounts.get(threadId) || 0) + 1;
  threadCallCounts.set(threadId, next);
  return next;
}

/**
 * Reset the per-thread call counter (primarily for tests).
 */
export function resetThreadCallCounts(): void {
  threadCallCounts.clear();
}

/**
 * Enforce the hard kill-switch for a thread.
 *
 * Combines the per-thread call ceiling with the existing cost/token budget
 * from {@link checkBudget}. On breach, raises a typed
 * {@link FirewallViolationError} so the caller can abort the turn.
 *
 * @param threadId  Thread under inspection.
 * @param config    Firewall config (provides `maxCallsPerThread`).
 * @param estimatedInputTokens  Optional token estimate for the budget check.
 * @param estimatedOutputTokens Optional token estimate for the budget check.
 * @throws {FirewallViolationError} when the ceiling is breached.
 */
export function enforceBudget(
  threadId: string,
  config: FirewallConfig,
  estimatedInputTokens = 0,
  estimatedOutputTokens = 0,
): void {
  // Per-thread call ceiling (hard kill-switch).
  if (config.maxCallsPerThread > 0) {
    const count = getThreadCallCount(threadId);
    if (count >= config.maxCallsPerThread) {
      logger.error(
        { threadId, count, limit: config.maxCallsPerThread },
        "[agent-firewall] Per-thread call budget exceeded — aborting turn",
      );
      throw new FirewallViolationError(
        `Firewall kill-switch: thread ${threadId} exceeded call budget (${count} >= ${config.maxCallsPerThread})`,
        { reason: "budget_exceeded", threadId },
      );
    }
  }

  // Reuse the shared cost/token budget from token-tracker.
  const budget = checkBudget(
    threadId,
    estimatedInputTokens,
    estimatedOutputTokens,
  );
  if (!budget.withinBudget) {
    logger.error(
      { threadId, reason: budget.reason },
      "[agent-firewall] Cost/token budget exceeded — aborting turn",
    );
    throw new FirewallViolationError(
      `Firewall kill-switch: ${budget.reason}`,
      { reason: "budget_exceeded", threadId },
    );
  }
}

/**
 * Clear the recorded call count for a thread (e.g. when a thread is reset).
 */
export function clearThreadCallCount(threadId: string): void {
  threadCallCounts.delete(threadId);
}

/**
 * Re-export the typed error for callers that want to instanceof-check it.
 */
export { FirewallViolationError } from "./types";
