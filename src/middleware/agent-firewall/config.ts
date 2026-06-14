/**
 * Agent Firewall configuration loader.
 *
 * Reads environment variables and compiles them into a {@link FirewallConfig}.
 *
 * Env vars:
 * - `FIREWALL_COMMAND_DENY`  — comma-separated regexes. Commands matching any
 *   pattern are blocked (never executed).
 * - `FIREWALL_COMMAND_ALLOW` — comma-separated regexes. When set, a command
 *   must match at least one pattern to be permitted (denylist still wins).
 * - `FIREWALL_NETWORK_ALLOW` — comma-separated host globs (e.g.
 *   `github.com,*.cloud.langfuse.com`). When set, fetch/url targets whose
 *   host is not matched are blocked.
 * - `FIREWALL_MAX_CALLS_PER_THREAD` — per-thread tool-call ceiling. When the
 *   running count exceeds it the firewall aborts the turn. Defaults to 0
 *   (disabled) so the firewall is permissive unless explicitly configured.
 *
 * When none of these are set, {@link loadFirewallConfig} returns an empty
 * config and the middleware becomes a no-op — existing tests stay green.
 */

import { createLogger } from "../../utils/logger";
import type { FirewallConfig } from "./types";

const logger = createLogger("agent-firewall");

/**
 * Split a comma-separated env value, trimming whitespace and dropping empties.
 */
function splitList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Compile a list of regex source strings into RegExp objects.
 * Invalid patterns are logged and skipped so one bad entry does not crash startup.
 */
function compileRegexes(sources: string[], label: string): RegExp[] {
  const out: RegExp[] = [];
  for (const src of sources) {
    try {
      out.push(new RegExp(src));
    } catch (err) {
      logger.warn(
        { err, pattern: src, label },
        "[agent-firewall] Skipping invalid regex pattern",
      );
    }
  }
  return out;
}

/**
 * Load the firewall configuration from the environment.
 *
 * Memoized: the first call caches the result so the middleware list sees a
 * single shared config. Call {@link resetFirewallConfig} in tests to re-read.
 */
let cached: FirewallConfig | null = null;

export function loadFirewallConfig(): FirewallConfig {
  if (cached) return cached;

  const commandDeny = compileRegexes(
    splitList(process.env.FIREWALL_COMMAND_DENY),
    "FIREWALL_COMMAND_DENY",
  );
  const commandAllow = compileRegexes(
    splitList(process.env.FIREWALL_COMMAND_ALLOW),
    "FIREWALL_COMMAND_ALLOW",
  );
  const networkAllow = splitList(process.env.FIREWALL_NETWORK_ALLOW);
  const maxCallsPerThread = Number.parseInt(
    process.env.FIREWALL_MAX_CALLS_PER_THREAD || "0",
    10,
  );

  const enabled =
    commandDeny.length > 0 ||
    commandAllow.length > 0 ||
    networkAllow.length > 0 ||
    maxCallsPerThread > 0;

  cached = {
    commandDeny,
    commandAllow,
    networkAllow,
    maxCallsPerThread: Number.isNaN(maxCallsPerThread) ? 0 : maxCallsPerThread,
    enabled,
  };

  logger.info(
    {
      enabled,
      denyCount: commandDeny.length,
      allowCount: commandAllow.length,
      networkCount: networkAllow.length,
      maxCallsPerThread: cached.maxCallsPerThread,
    },
    "[agent-firewall] Configuration loaded",
  );

  return cached;
}

/**
 * Reset the cached configuration. Primarily for tests that mutate env vars.
 */
export function resetFirewallConfig(): void {
  cached = null;
}
