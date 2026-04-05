/**
 * Tool invocation limits middleware for DeepAgents.
 *
 * Tracks how many times each tool is called per thread and enforces limits
 * to prevent runaway agent behavior. Provides actionable error messages to
 * guide the agent toward alternative approaches when limits are exceeded.
 *
 * Features:
 * - Per-tool invocation counting with configurable limits
 * - Debouncing to detect repeated identical calls within a time window
 * - Customizable limits per tool via environment variables
 * - Automatic cleanup of old invocation records
 * - Actionable error messages with next steps
 */

import { createLogger } from "../utils/logger";

const logger = createLogger("tool-invocation-limits");

// ============================================================================
// Configuration
// ============================================================================

/**
 * Default maximum number of times a tool can be invoked per thread.
 * Can be overridden via TOOL_MAX_INVOCATIONS_DEFAULT environment variable.
 */
const TOOL_MAX_INVOCATIONS_DEFAULT = Number.parseInt(
  process.env.TOOL_MAX_INVOCATIONS_DEFAULT || "10",
  10,
);

/**
 * Time window in milliseconds for detecting duplicate tool calls.
 * If the same tool is called with identical args within this window,
 * it will be blocked as a duplicate.
 * Can be overridden via TOOL_DEBOUNCE_WINDOW_MS environment variable.
 */
const TOOL_DEBOUNCE_WINDOW_MS = Number.parseInt(
  process.env.TOOL_DEBOUNCE_WINDOW_MS || "5000",
  10,
);

/**
 * Time in milliseconds after which old invocation records are cleaned up.
 * Default: 1 hour (3600000 ms)
 */
const INVOCATION_TTL_MS = 3600000;

/**
 * Custom per-tool limits specified as JSON string.
 * Format: '{"tool_name": limit, "another_tool": 20}'
 * Example: '{"grep": 5, "search_files": 3}'
 *
 * Can be provided via PER_TOOL_LIMITS_JSON environment variable.
 */
function loadPerToolLimits(): Record<string, number> {
  const limitsJson = process.env.PER_TOOL_LIMITS_JSON;
  if (!limitsJson) {
    return {};
  }

  try {
    const limits = JSON.parse(limitsJson) as Record<string, number>;
    logger.info({ limits }, "[tool-invocation-limits] Loaded custom per-tool limits");
    return limits;
  } catch (err) {
    logger.warn(
      { err, limitsJson },
      "[tool-invocation-limits] Failed to parse PER_TOOL_LIMITS_JSON, using defaults",
    );
    return {};
  }
}

const perToolLimits = loadPerToolLimits();

// ============================================================================
// Interface Definitions
// ============================================================================

/**
 * Represents a single tool invocation with its arguments and timestamp.
 */
export interface ToolInvocation {
  /** Name of the tool that was invoked */
  toolName: string;
  /** Arguments passed to the tool */
  args: Record<string, unknown>;
  /** Unix timestamp in milliseconds when the tool was invoked */
  timestamp: number;
  /** Unique identifier for this invocation (optional) */
  id?: string;
}

/**
 * Result of checking whether a tool call should be blocked.
 */
export interface ToolBlockCheck {
  /** Whether the tool call should be blocked */
  block: boolean;
  /** Human-readable reason for blocking (if block is true) */
  reason?: string;
  /** Current invocation count for this tool in this thread */
  count?: number;
  /** The tool name that was checked */
  toolName?: string;
  /** The thread ID that was checked */
  threadId?: string;
}

/**
 * Interface for tracking and limiting tool invocations per thread.
 */
export interface ToolInvocationTracker {
  /**
   * Record a tool call for the given thread.
   * @param threadId - Thread identifier
   * @param toolName - Name of the tool being called
   * @param args - Arguments passed to the tool
   */
  trackToolCall(
    threadId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): void;

  /**
   * Check if a tool call should be blocked based on invocation limits.
   * @param threadId - Thread identifier
   * @param toolName - Name of the tool being called
   * @param args - Arguments passed to the tool
   * @returns Object indicating whether to block and the reason
   */
  shouldBlockToolCall(
    threadId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): ToolBlockCheck;

  /**
   * Get the current invocation count for a specific tool in a thread.
   * @param threadId - Thread identifier
   * @param toolName - Name of the tool
   * @returns Number of times the tool has been invoked
   */
  getInvocationCount(threadId: string, toolName: string): number;

  /**
   * Clear all invocation records for a thread.
   * @param threadId - Thread identifier
   */
  clearThread(threadId: string): void;

  /**
   * Get all invocation records for a thread (for debugging).
   * @param threadId - Thread identifier
   * @returns Array of all tool invocations for the thread
   */
  getThreadInvocations(threadId: string): ToolInvocation[];
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a stable fingerprint for tool arguments to detect duplicate calls.
 * Handles objects, arrays, and primitives in a deterministic way.
 */
function createArgsFingerprint(args: Record<string, unknown>): string {
  try {
    // Sort keys to ensure consistent ordering
    const sortedKeys = Object.keys(args).sort();
    const sortedArgs: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      sortedArgs[key] = args[key];
    }
    return JSON.stringify(sortedArgs);
  } catch (err) {
    // Fallback for circular references or unserializable objects
    logger.warn({ err }, "[tool-invocation-limits] Failed to serialize args");
    return String(args);
  }
}

/**
 * Generate an actionable error message when a tool call is blocked.
 * Provides clear guidance on next steps for the agent.
 */
function generateBlockMessage(params: {
  toolName: string;
  threadId: string;
  count: number;
  reason: string;
}): string {
  const { toolName, threadId, count, reason } = params;

  if (reason === "debounce") {
    return `Tool \`${toolName}\` was called recently with identical arguments.

This appears to be a retry loop. The previous attempt may still be processing,
or the current approach is not working.

NEXT STEPS:
1. Review the previous tool output carefully - it may contain the solution
2. Try a different tool or approach
3. Check if the arguments need adjustment
4. If this continues, escalate to a human operator

Context: threadId=${threadId}, tool=${toolName}`;
  }

  if (reason === "limit_exceeded") {
    return `Tool \`${toolName}\` has been called ${count} times. Current approach is not working.

You have exceeded the invocation limit for this tool. Repeated calls are unlikely
to succeed and may indicate a fundamental issue with the current approach.

NEXT STEPS:
1. Read error messages carefully - they may contain the solution
2. Try an alternative tool or approach
3. Modify your strategy based on previous results
4. If this continues, escalate to a human operator

Context: threadId=${threadId}, tool=${toolName}, attempts=${count}`;
  }

  return `Tool \`${toolName}\` call blocked: ${reason}`;
}

/**
 * In-memory storage for tool invocations organized by thread.
 */
class InMemoryToolInvocationTracker implements ToolInvocationTracker {
  private threadInvocations = new Map<string, ToolInvocation[]>();

  /**
   * Clean up old invocation records for all threads.
   * Removes entries older than INVOCATION_TTL_MS.
   */
  private cleanupOldEntries(): void {
    const now = Date.now();
    const cutoff = now - INVOCATION_TTL_MS;

    for (const [threadId, invocations] of this.threadInvocations.entries()) {
      const filtered = invocations.filter((inv) => inv.timestamp > cutoff);

      if (filtered.length < invocations.length) {
        if (filtered.length === 0) {
          this.threadInvocations.delete(threadId);
        } else {
          this.threadInvocations.set(threadId, filtered);
        }

        logger.debug(
          { threadId, removed: invocations.length - filtered.length },
          "[tool-invocation-limits] Cleaned up old invocations",
        );
      }
    }
  }

  /**
   * Get the maximum allowed invocations for a specific tool.
   * Uses per-tool limits if configured, otherwise uses the default.
   */
  private getMaxInvocations(toolName: string): number {
    const customLimit = perToolLimits[toolName];
    if (typeof customLimit === "number" && customLimit > 0) {
      return customLimit;
    }
    return TOOL_MAX_INVOCATIONS_DEFAULT;
  }

  trackToolCall(
    threadId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): void {
    // Periodically clean up old entries
    if (Math.random() < 0.1) { // 10% chance to avoid excessive cleanup calls
      this.cleanupOldEntries();
    }

    const invocation: ToolInvocation = {
      toolName,
      args,
      timestamp: Date.now(),
      id: `${threadId}-${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    };

    let invocations = this.threadInvocations.get(threadId);
    if (!invocations) {
      invocations = [];
      this.threadInvocations.set(threadId, invocations);
    }

    invocations.push(invocation);

    logger.debug(
      { threadId, toolName, args, id: invocation.id },
      "[tool-invocation-limits] Tool call tracked",
    );
  }

  shouldBlockToolCall(
    threadId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): ToolBlockCheck {
    const invocations = this.threadInvocations.get(threadId) || [];
    const now = Date.now();
    const argsFingerprint = createArgsFingerprint(args);

    // Check for debounce: same tool with same args within window
    for (let i = invocations.length - 1; i >= 0; i--) {
      const inv = invocations[i];
      if (inv.toolName === toolName) {
        const timeSince = now - inv.timestamp;
        if (timeSince <= TOOL_DEBOUNCE_WINDOW_MS) {
          const invArgsFingerprint = createArgsFingerprint(inv.args);
          if (invArgsFingerprint === argsFingerprint) {
            logger.warn(
              { threadId, toolName, args, timeSince },
              "[tool-invocation-limits] Blocked duplicate call within debounce window",
            );

            return {
              block: true,
              reason: generateBlockMessage({
                toolName,
                threadId,
                count: this.getInvocationCount(threadId, toolName),
                reason: "debounce",
              }),
              count: this.getInvocationCount(threadId, toolName),
              toolName,
              threadId,
            };
          }
        }
      }
    }

    // Check invocation limit
    const toolInvocations = invocations.filter((inv) => inv.toolName === toolName);
    const count = toolInvocations.length;
    const maxInvocations = this.getMaxInvocations(toolName);

    if (count >= maxInvocations) {
      logger.warn(
        { threadId, toolName, count, maxInvocations },
        "[tool-invocation-limits] Tool invocation limit exceeded",
      );

      return {
        block: true,
        reason: generateBlockMessage({
          toolName,
          threadId,
          count,
          reason: "limit_exceeded",
        }),
        count,
        toolName,
        threadId,
      };
    }

    return {
      block: false,
      count,
      toolName,
      threadId,
    };
  }

  getInvocationCount(threadId: string, toolName: string): number {
    const invocations = this.threadInvocations.get(threadId) || [];
    return invocations.filter((inv) => inv.toolName === toolName).length;
  }

  clearThread(threadId: string): void {
    const deleted = this.threadInvocations.delete(threadId);
    if (deleted) {
      logger.info(
        { threadId },
        "[tool-invocation-limits] Cleared invocations for thread",
      );
    }
  }

  getThreadInvocations(threadId: string): ToolInvocation[] {
    return this.threadInvocations.get(threadId) || [];
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Global singleton instance of the tool invocation tracker.
 * Use this instance across the application to ensure consistent tracking.
 */
export const toolInvocationTracker: ToolInvocationTracker =
  new InMemoryToolInvocationTracker();

/**
 * Reset the global tracker (primarily for testing).
 * Clears all invocation records across all threads.
 */
export function resetToolInvocationTracker(): void {
  const tracker = toolInvocationTracker as InMemoryToolInvocationTracker;
  // Access private method via type assertion for testing
  (tracker as any).threadInvocations.clear();
  logger.info("[tool-invocation-limits] Tracker reset");
}

/**
 * Get statistics about the current state of the tracker (for debugging).
 */
export function getTrackerStats(): {
  totalThreads: number;
  totalInvocations: number;
  invocationsByThread: Record<string, number>;
  invocationsByTool: Record<string, number>;
} {
  const tracker = toolInvocationTracker as InMemoryToolInvocationTracker;
  const threadInvocations = (tracker as any).threadInvocations as Map<
    string,
    ToolInvocation[]
  >;

  let totalInvocations = 0;
  const invocationsByThread: Record<string, number> = {};
  const invocationsByTool: Record<string, number> = {};

  for (const [threadId, invocations] of threadInvocations.entries()) {
    invocationsByThread[threadId] = invocations.length;
    totalInvocations += invocations.length;

    for (const inv of invocations) {
      invocationsByTool[inv.toolName] = (invocationsByTool[inv.toolName] || 0) + 1;
    }
  }

  return {
    totalThreads: threadInvocations.size,
    totalInvocations,
    invocationsByThread,
    invocationsByTool,
  };
}
