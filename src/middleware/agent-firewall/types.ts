/**
 * Agent Firewall types.
 *
 * Shared shape for the command/network deny- and allow-lists plus the
 * per-thread budget that backs the hard kill-switch.
 */

/**
 * Raised when the firewall blocks a tool call or aborts a turn on budget
 * breach. Carries enough context for the caller to surface a useful message
 * to the agent / operator.
 */
export class FirewallViolationError extends Error {
  /** Why the firewall intervened: denied command, non-allowlisted host, budget breach. */
  readonly reason: FirewallViolationReason;
  /** Name of the tool whose invocation triggered the violation (when applicable). */
  readonly toolName?: string;
  /** Thread id the violation occurred under (when known). */
  readonly threadId?: string;

  constructor(
    message: string,
    opts: {
      reason: FirewallViolationReason;
      toolName?: string;
      threadId?: string;
    },
  ) {
    super(message);
    this.name = "FirewallViolationError";
    this.reason = opts.reason;
    this.toolName = opts.toolName;
    this.threadId = opts.threadId;
  }
}

export type FirewallViolationReason =
  | "command_denied"
  | "network_denied"
  | "budget_exceeded";

/**
 * Result of inspecting a single tool call. `block` indicates the tool must not
 * execute; `reason` is a human-readable explanation for logging / surfacing.
 */
export interface FirewallCheck {
  /** Whether the tool call should be blocked. */
  block: boolean;
  /** Human-readable reason for blocking (set when `block` is true). */
  reason?: string;
  /** Which rule fired, when known. */
  rule?: FirewallViolationReason;
}

/**
 * Parsed firewall configuration. Built once from environment at startup and
 * passed to the middleware factory. When both lists are empty the firewall is
 * a no-op (permissive) so existing tests stay green.
 */
export interface FirewallConfig {
  /** Compiled regex denylist for command/shell tool arguments. */
  commandDeny: RegExp[];
  /** Compiled regex allowlist for command/shell tool arguments (optional). */
  commandAllow: RegExp[];
  /** Host-glob allowlist for fetch/url tool targets. Empty = no network rule. */
  networkAllow: string[];
  /** Per-thread call budget before the hard kill-switch trips. 0 = disabled. */
  maxCallsPerThread: number;
  /** Whether the firewall has any active rule (used to short-circuit). */
  enabled: boolean;
}
