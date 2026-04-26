/**
 * Configuration types for compact-middleware.
 *
 * Ported from: https://github.com/emanueleielo/compact-middleware
 */

/**
 * Trigger format for compaction.
 * Can be based on absolute token count, fraction of context window, or message count.
 */
export type TriggerFormat =
  | { type: "tokens"; value: number }
  | { type: "fraction"; value: number }
  | { type: "messages"; value: number };

/**
 * Parse trigger format from tuple-like input.
 */
export function parseTrigger(trigger: string | [string, number]): TriggerFormat {
  if (typeof trigger === "string") {
    const [type, valueStr] = trigger.split(":");
    const value = Number.parseFloat(valueStr);
    if (type === "tokens") return { type: "tokens", value };
    if (type === "fraction") return { type: "fraction", value };
    if (type === "messages") return { type: "messages", value };
    throw new Error(`Unknown trigger type: ${type}`);
  }

  const [type, value] = trigger;
  if (type === "tokens") return { type: "tokens", value };
  if (type === "fraction") return { type: "fraction", value };
  if (type === "messages") return { type: "messages", value };
  throw new Error(`Unknown trigger type: ${type}`);
}

/**
 * Microcompaction configuration.
 * Clears stale tool results based on time gap.
 */
export interface MicrocompactConfig {
  /** Enable microcompaction (default: true) */
  enabled?: boolean;
  /** Clear tool results after this many minutes of gap (default: 60) */
  gapThresholdMinutes?: number;
  /** Always keep this many recent tool results (default: 5) */
  keepRecent?: number;
  /** Tools whose results can be cleared */
  compactableTools?: Set<string>;
}

/**
 * Argument truncation configuration.
 */
export interface TruncateArgsConfig {
  /** Enable argument truncation (default: true) */
  enabled?: boolean;
  /** When to start truncating (default: 0.80 = 80% of context) */
  trigger?: TriggerFormat;
  /** Maximum characters per argument value (default: 2000) */
  maxLength?: number;
  /** Truncate all tools, not just write/edit (default: true) */
  truncateAllTools?: boolean;
}

/**
 * Message collapsing configuration.
 */
export interface CollapseConfig {
  /** Enable message collapsing (default: true) */
  enabled?: boolean;
  /** Minimum consecutive reads to collapse (default: 2) */
  minGroupSize?: number;
  /** Tools to collapse results for */
  collapseTools?: Set<string>;
}

/**
 * Restoration configuration.
 * Re-reads important files after compaction.
 */
export interface RestorationConfig {
  /** Enable restoration (default: true) */
  enabled?: boolean;
  /** Re-read this many recent files (default: 5) */
  maxFiles?: number;
  /** Total character budget for restored content (default: 30000) */
  fileBudgetChars?: number;
  /** Maximum characters per file (default: 10000) */
  perFileChars?: number;
  /** Re-attach active plan state (default: true) */
  restorePlans?: boolean;
}

/**
 * Token budget configuration.
 */
export interface TokenBudgetConfig {
  /** Maximum characters per tool result (default: 50000) */
  perToolChars?: number;
  /** Maximum aggregate characters per message turn (default: 200000) */
  perMessageChars?: number;
}

/**
 * Main compaction configuration.
 */
export interface CompactionConfig {
  /** When to trigger compaction cascade (default: 70% of context window) */
  cascadeTrigger?: TriggerFormat;
  /** When to trigger LLM summarization (default: 85% of context window) */
  trigger?: TriggerFormat | TriggerFormat[];
  /** How many messages to keep after compaction (default: 10) */
  keep?: TriggerFormat;
  /** Maximum consecutive failures before circuit breaker (default: 3) */
  maxConsecutiveFailures?: number;
  /** Custom instructions to add to summary prompt */
  customInstructions?: string;
  /** Suppress follow-up questions after compaction (default: false) */
  suppressFollowUpQuestions?: boolean;
  /** Microcompaction settings */
  microcompact?: MicrocompactConfig;
  /** Argument truncation settings */
  truncateArgs?: TruncateArgsConfig;
  /** Message collapsing settings */
  collapse?: CollapseConfig;
  /** Restoration settings */
  restoration?: RestorationConfig;
  /** Token budget settings */
  tokenBudget?: TokenBudgetConfig;
}

/**
 * Default configuration values matching Claude Code's production settings.
 */
export const DEFAULT_COMPACTION_CONFIG: Required<CompactionConfig> = {
  cascadeTrigger: { type: "fraction", value: 0.7 },
  trigger: { type: "fraction", value: 0.85 },
  keep: { type: "messages", value: 10 },
  maxConsecutiveFailures: 3,
  customInstructions: "",
  suppressFollowUpQuestions: false,
  microcompact: {
    enabled: true,
    gapThresholdMinutes: 60,
    keepRecent: 5,
    compactableTools: new Set([
      "read_file",
      "execute",
      "grep",
      "glob",
      "web_search",
      "web_fetch",
      "edit_file",
      "write_file",
    ]),
  },
  truncateArgs: {
    enabled: true,
    trigger: { type: "fraction", value: 0.8 },
    maxLength: 2000,
    truncateAllTools: true,
  },
  collapse: {
    enabled: true,
    minGroupSize: 2,
    collapseTools: new Set(["read_file", "grep", "glob", "web_search"]),
  },
  restoration: {
    enabled: true,
    maxFiles: 5,
    fileBudgetChars: 30000,
    perFileChars: 10000,
    restorePlans: true,
  },
  tokenBudget: {
    perToolChars: 50000,
    perMessageChars: 200000,
  },
};

/**
 * Compaction result metadata.
 */
export interface CompactionMetadata {
  /** Original message count */
  originalCount: number;
  /** Compacted message count */
  compactedCount: number;
  /** Number of messages removed */
  removedCount: number;
  /** Estimated token count before compaction */
  originalTokens: number;
  /** Estimated token count after compaction */
  compactedTokens: number;
  /** Which level of compaction was applied */
  level: "collapse" | "truncate" | "microcompact" | "summarize" | "none";
  /** Summary that was generated (if any) */
  summary?: string;
  /** Files that were restored (if any) */
  restoredFiles?: string[];
}

/**
 * State for tracking consecutive failures.
 */
export interface CircuitBreakerState {
  /** Number of consecutive failures */
  consecutiveFailures: number;
  /** Last failure timestamp */
  lastFailureTime?: number;
  /** Whether circuit is open (blocking compaction) */
  isOpen: boolean;
}

/**
 * Message type for tracking tool results.
 */
export interface ToolResultInfo {
  /** Message index */
  index: number;
  /** Tool name */
  toolName: string;
  /** Timestamp when result was received */
  timestamp: number;
  /** Whether result has been cleared */
  cleared: boolean;
}
