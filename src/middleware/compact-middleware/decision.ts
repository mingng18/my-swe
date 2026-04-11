/**
 * Multi-level compaction cascade engine.
 *
 * Implements the 4-level compaction strategy:
 * 1. COLLAPSE - Group consecutive tool results
 * 2. TRUNCATE - Shorten large tool arguments
 * 3. MICROCOMPACT - Clear stale tool results
 * 4. SUMMARIZE - LLM-based summarization (expensive)
 *
 * Levels 1-3 are free (no LLM call) and run every turn.
 * Level 4 only runs when the token threshold is exceeded.
 *
 * Ported from: https://github.com/emanueleielo/compact-middleware
 */

import type { BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { collapseMessages } from "./collapse";
import { truncateArguments } from "./truncation";
import { microcompactMessages } from "./microcompact";
import { compactWithSummary, partialCompaction } from "./compaction";
import { applyRestoration } from "./restoration";
import {
  countMessagesTokens,
  shouldTriggerCompaction,
  calculateTokenThreshold,
} from "./tokens";
import type {
  CompactionConfig,
  CompactionMetadata,
  CircuitBreakerState,
  TriggerFormat,
} from "./config";
import { createLogger } from "../../utils/logger";

const logger = createLogger("compact-middleware:decision");

/**
 * Compaction level result.
 */
interface LevelResult {
  /** Level that was applied */
  level: CompactionMetadata["level"];
  /** Messages after this level */
  messages: BaseMessage[];
  /** Number of messages removed/modified */
  changeCount: number;
}

/**
 * Normalize trigger format(s) to array.
 */
function normalizeTriggers(
  trigger: TriggerFormat | TriggerFormat[] | undefined,
): TriggerFormat[] {
  if (!trigger) return [{ type: "fraction", value: 0.85 }];

  if (Array.isArray(trigger)) {
    return trigger.length === 1 ? [trigger[0]] : trigger;
  }

  return [trigger];
}

/**
 * Check if any trigger should fire.
 */
function shouldAnyTriggerFire(
  triggers: TriggerFormat[],
  messages: BaseMessage[],
  model: string,
): boolean {
  return triggers.some((t) => shouldTriggerCompaction(messages, t, model));
}

/**
 * Apply level 1: COLLAPSE.
 *
 * Groups consecutive tool results of the same type into badge summaries.
 */
function applyCollapse(
  messages: BaseMessage[],
  config: CompactionConfig,
): LevelResult {
  const collapseConfig = config.collapse ?? { enabled: true };

  const result = collapseMessages(messages, collapseConfig);

  logger.debug(
    {
      collapsedCount: result.collapsedCount,
    },
    "[decision] Level 1 (COLLAPSE) applied",
  );

  return {
    level: result.collapsedCount > 0 ? "collapse" : "none",
    messages: result.messages,
    changeCount: result.collapsedCount,
  };
}

/**
 * Apply level 2: TRUNCATE.
 *
 * Shortens large tool arguments in old messages.
 */
function applyTruncate(
  messages: BaseMessage[],
  config: CompactionConfig,
): LevelResult {
  const truncateConfig = config.truncateArgs ?? { enabled: true };

  const result = truncateArguments(messages, truncateConfig);

  logger.debug(
    {
      truncatedCount: result.truncatedCount,
    },
    "[decision] Level 2 (TRUNCATE) applied",
  );

  return {
    level: result.truncatedCount > 0 ? "truncate" : "none",
    messages: result.messages,
    changeCount: result.truncatedCount,
  };
}

/**
 * Apply level 3: MICROCOMPACT.
 *
 * Clears stale tool results based on time gaps.
 */
function applyMicrocompact(
  messages: BaseMessage[],
  config: CompactionConfig,
): LevelResult {
  const microcompactConfig = config.microcompact ?? { enabled: true };

  const result = microcompactMessages(messages, microcompactConfig);

  logger.debug(
    {
      clearedCount: result.clearedTools.length,
    },
    "[decision] Level 3 (MICROCOMPACT) applied",
  );

  return {
    level: result.clearedTools.length > 0 ? "microcompact" : "none",
    messages: result.messages,
    changeCount: result.clearedTools.length,
  };
}

/**
 * Apply level 4: SUMMARIZE.
 *
 * Uses LLM to create a comprehensive summary of the conversation.
 * This is the expensive level that only runs when thresholds are exceeded.
 */
async function applySummarize(
  messages: BaseMessage[],
  model: BaseChatModel,
  config: CompactionConfig,
  circuitBreaker: CircuitBreakerState,
): Promise<LevelResult & { summary?: string; circuitBroken?: boolean }> {
  // Check circuit breaker
  const now = Date.now();
  const cooldownMs = 60000; // 1 minute cooldown
  if (
    circuitBreaker.isOpen &&
    circuitBreaker.lastFailureTime &&
    now - circuitBreaker.lastFailureTime < cooldownMs
  ) {
    logger.warn(
      { consecutiveFailures: circuitBreaker.consecutiveFailures },
      "[decision] Circuit breaker OPEN, skipping SUMMARIZE",
    );

    return {
      level: "none",
      messages,
      changeCount: 0,
      circuitBroken: true,
    };
  }

  logger.info("[decision] Level 4 (SUMMARIZE) applying...");

  try {
    const result = await compactWithSummary(messages, model, config);

    // Reset circuit breaker on success
    circuitBreaker.consecutiveFailures = 0;
    circuitBreaker.isOpen = false;

    logger.info(
      {
        originalTokens: result.originalTokens,
        compactedTokens: result.compactedTokens,
        reduction:
          ((result.originalTokens - result.compactedTokens) /
            result.originalTokens) *
          100,
      },
      "[decision] Level 4 (SUMMARIZE) complete",
    );

    return {
      level: "summarize",
      messages: result.messages,
      changeCount: messages.length - result.messages.length,
      summary: result.summary,
      circuitBroken: false,
    };
  } catch (error) {
    // Update circuit breaker state
    circuitBreaker.consecutiveFailures++;
    circuitBreaker.lastFailureTime = now;

    const maxFailures = config.maxConsecutiveFailures ?? 3;
    if (circuitBreaker.consecutiveFailures >= maxFailures) {
      circuitBreaker.isOpen = true;
      logger.error(
        { consecutiveFailures: circuitBreaker.consecutiveFailures },
        "[decision] Circuit breaker OPEN after consecutive failures",
      );
    }

    logger.error({ error }, "[decision] Level 4 (SUMMARIZE) failed");

    // Return messages unchanged
    return {
      level: "none",
      messages,
      changeCount: 0,
      circuitBroken: false,
    };
  }
}

/**
 * Apply restoration after compaction.
 *
 * Re-reads important files and restores plan state.
 */
function applyRestorationAfterCompaction(
  messages: BaseMessage[],
  config: CompactionConfig,
): { messages: BaseMessage[]; restoredFiles: string[] } {
  const restorationConfig = config.restoration ?? { enabled: true };

  const result = applyRestoration(messages, restorationConfig);

  if (result.restoredFiles.length > 0 || result.restoredPlan) {
    logger.info(
      {
        restoredFiles: result.restoredFiles.length,
        restoredPlan: result.restoredPlan,
      },
      "[decision] Post-compaction restoration applied",
    );
  }

  return {
    messages: result.messages,
    restoredFiles: result.restoredFiles,
  };
}

/**
 * Run the full compaction cascade.
 *
 * @param messages - Messages to compact
 * @param model - LLM model for summarization
 * @param modelName - Model name for context size calculation
 * @param config - Compaction configuration
 * @param circuitBreaker - Circuit breaker state
 * @returns Compaction result
 */
export async function runCompactionCascade(
  messages: BaseMessage[],
  model: BaseChatModel,
  modelName: string,
  config: CompactionConfig,
  circuitBreaker: CircuitBreakerState,
): Promise<{
  messages: BaseMessage[];
  metadata: CompactionMetadata;
}> {
  const originalCount = messages.length;
  const originalTokens = countMessagesTokens(messages);

  logger.debug(
    {
      messageCount: messages.length,
      tokenCount: originalTokens,
    },
    "[decision] Starting compaction cascade",
  );

  // Normalize triggers
  const triggers = normalizeTriggers(config.trigger);

  // Apply free levels (1-3) unconditionally
  let currentMessages = messages;
  let totalChanges = 0;
  let appliedLevel: CompactionMetadata["level"] = "none";

  // Level 1: COLLAPSE
  const collapseResult = applyCollapse(currentMessages, config);
  currentMessages = collapseResult.messages;
  totalChanges += collapseResult.changeCount;
  if (collapseResult.level !== "none") {
    appliedLevel = collapseResult.level;
  }

  // Level 2: TRUNCATE
  const truncateResult = applyTruncate(currentMessages, config);
  currentMessages = truncateResult.messages;
  totalChanges += truncateResult.changeCount;
  if (truncateResult.level !== "none" && appliedLevel === "none") {
    appliedLevel = truncateResult.level;
  }

  // Level 3: MICROCOMPACT
  const microcompactResult = applyMicrocompact(currentMessages, config);
  currentMessages = microcompactResult.messages;
  totalChanges += microcompactResult.changeCount;
  if (microcompactResult.level !== "none" && appliedLevel === "none") {
    appliedLevel = microcompactResult.level;
  }

  // Check if we need level 4 (SUMMARIZE)
  const currentTokens = countMessagesTokens(currentMessages);

  if (shouldAnyTriggerFire(triggers, currentMessages, modelName)) {
    logger.info(
      {
        currentTokens,
        threshold: calculateTokenThreshold(triggers[0], modelName),
      },
      "[decision] Token threshold exceeded, applying Level 4 (SUMMARIZE)",
    );

    // Level 4: SUMMARIZE
    const summarizeResult = await applySummarize(
      currentMessages,
      model,
      config,
      circuitBreaker,
    );

    currentMessages = summarizeResult.messages;
    if (summarizeResult.level !== "none") {
      appliedLevel = summarizeResult.level;
      totalChanges += summarizeResult.changeCount;

      // Apply restoration after summarization
      const restorationResult = applyRestorationAfterCompaction(
        currentMessages,
        config,
      );
      currentMessages = restorationResult.messages;
    }
  }

  const compactedTokens = countMessagesTokens(currentMessages);

  const metadata: CompactionMetadata = {
    originalCount,
    compactedCount: currentMessages.length,
    removedCount: originalCount - currentMessages.length,
    originalTokens,
    compactedTokens,
    level: appliedLevel,
  };

  logger.info(
    {
      ...metadata,
      reduction: ((originalTokens - compactedTokens) / originalTokens) * 100,
    },
    "[decision] Compaction cascade complete",
  );

  return {
    messages: currentMessages,
    metadata,
  };
}

/**
 * Create a fresh circuit breaker state.
 */
export function createCircuitBreakerState(): CircuitBreakerState {
  return {
    consecutiveFailures: 0,
    lastFailureTime: undefined,
    isOpen: false,
  };
}

/**
 * Reset the circuit breaker.
 */
export function resetCircuitBreaker(state: CircuitBreakerState): void {
  state.consecutiveFailures = 0;
  state.lastFailureTime = undefined;
  state.isOpen = false;
}
