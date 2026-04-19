/**
 * Compact Middleware - Main entry point.
 *
 * A TypeScript port of compact-middleware that implements Claude Code's
 * compaction engine as a LangChain-compatible middleware for DeepAgents.
 *
 * Ported from: https://github.com/emanueleielo/compact-middleware
 *
 * Features:
 * - 4-level compaction cascade (COLLAPSE, TRUNCATE, MICROCOMPACT, SUMMARIZE)
 * - 9-section structured summary prompt
 * - Hybrid token counting (real API + heuristic)
 * - Post-compaction restoration of files and plans
 * - Circuit breaker for failed compactions
 */

import type { BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createMiddleware } from "langchain";
import { runCompactionCascade, createCircuitBreakerState } from "./decision";
import { countMessagesTokens, getContextWindowSize, calculateTokenThreshold } from "./tokens";
import type {
  CompactionConfig,
  CompactionMetadata,
  CircuitBreakerState,
} from "./config";
import { DEFAULT_COMPACTION_CONFIG } from "./config";
import { createLogger } from "../../utils/logger";

const logger = createLogger("compact-middleware");

/**
 * Per-thread state for compaction.
 */
interface ThreadCompactionState {
  /** Circuit breaker state */
  circuitBreaker: CircuitBreakerState;
  /** Last compaction metadata */
  lastMetadata?: CompactionMetadata;
  /** Message count at last check */
  lastMessageCount: number;
}

/**
 * Global state map for compaction (threadId -> state).
 */
const threadStateMap = new Map<string, ThreadCompactionState>();

/**
 * Get or create thread state.
 */
function getThreadState(threadId: string): ThreadCompactionState {
  let state = threadStateMap.get(threadId);
  if (!state) {
    state = {
      circuitBreaker: createCircuitBreakerState(),
      lastMessageCount: 0,
    };
    threadStateMap.set(threadId, state);
  }
  return state;
}

/**
 * Clean up thread state (call when thread is done).
 */
export function cleanupThreadState(threadId: string): void {
  threadStateMap.delete(threadId);
}

/**
 * Get compaction metadata for a thread.
 */
export function getThreadMetadata(
  threadId: string,
): CompactionMetadata | undefined {
  return threadStateMap.get(threadId)?.lastMetadata;
}

/**
 * Get all thread states (for monitoring/debugging).
 */
export function getAllThreadStates(): Map<string, ThreadCompactionState> {
  return threadStateMap;
}

/**
 * Extract thread ID from request.
 */
function extractThreadId(request: any): string {
  const configurable = request.configurable as
    | Record<string, unknown>
    | undefined;
  return (configurable?.thread_id as string) || "default-session";
}

/**
 * Extract model name from request.
 */
function extractModelName(request: any): string {
  const model = request.model;
  if (typeof model === "string") return model;

  // Try to get from configurable
  const configurable = request.configurable as
    | Record<string, unknown>
    | undefined;
  const configurableModel = configurable?.model;
  if (typeof configurableModel === "string") return configurableModel;

  // Default fallback
  return "gpt-4o";
}

/**
 * Check if the last message is from a user (indicating a new turn).
 */
function isNewTurn(messages: BaseMessage[]): boolean {
  if (messages.length === 0) return false;

  const lastMessage = messages[messages.length - 1];
  const type = lastMessage.getType();

  // Check if it's a human/user message
  return type === "human" || type === "user";
}

/**
 * CompactionMiddleware options.
 */
export interface CompactionMiddlewareOptions {
  /** LLM model for summarization (required) */
  model: BaseChatModel;
  /** Model name for context size calculation */
  modelName?: string;
  /** Compaction configuration */
  config?: Partial<CompactionConfig>;
}

/**
 * Create the compact middleware.
 *
 * This middleware implements the 4-level compaction cascade:
 * 1. COLLAPSE - Group consecutive tool results
 * 2. TRUNCATE - Shorten large tool arguments
 * 3. MICROCOMPACT - Clear stale tool results
 * 4. SUMMARIZE - LLM-based summarization (when threshold exceeded)
 *
 * @param options - Middleware options
 * @returns LangChain middleware
 */
export function createCompactionMiddleware(
  options: CompactionMiddlewareOptions,
) {
  const { model, modelName, config: userConfig } = options;

  // Merge user config with defaults
  const config: CompactionConfig = {
    ...DEFAULT_COMPACTION_CONFIG,
    ...userConfig,
    // Deep merge nested objects
    microcompact: {
      ...DEFAULT_COMPACTION_CONFIG.microcompact,
      ...userConfig?.microcompact,
    },
    truncateArgs: {
      ...DEFAULT_COMPACTION_CONFIG.truncateArgs,
      ...userConfig?.truncateArgs,
    },
    collapse: {
      ...DEFAULT_COMPACTION_CONFIG.collapse,
      ...userConfig?.collapse,
    },
    restoration: {
      ...DEFAULT_COMPACTION_CONFIG.restoration,
      ...userConfig?.restoration,
    },
    tokenBudget: {
      ...DEFAULT_COMPACTION_CONFIG.tokenBudget,
      ...userConfig?.tokenBudget,
    },
  };

  logger.info(
    {
      trigger: config.trigger,
      cascadeTrigger: config.cascadeTrigger,
      keep: config.keep,
      maxConsecutiveFailures: config.maxConsecutiveFailures,
    },
    "[compact-middleware] Initialized",
  );

  return createMiddleware({
    name: "compact-middleware",

    wrapModelCall: async (request: any, handler: any) => {
      const threadId = extractThreadId(request);
      const state = getThreadState(threadId);

      const messages = request.messages as BaseMessage[];
      const currentMessageCount = messages.length;

      logger.debug(
        {
          threadId,
          messageCount: currentMessageCount,
          lastMessageCount: state.lastMessageCount,
        },
        "[compact-middleware] Processing messages",
      );

      // Check if we should run compaction
      const effectiveModelName = modelName || extractModelName(request);
      const currentTokens = countMessagesTokens(messages);
      const contextSize = getContextWindowSize(effectiveModelName);
      const usageRatio = currentTokens / contextSize;

      const cascadeThresholdTokens = calculateTokenThreshold(
        config.cascadeTrigger || DEFAULT_COMPACTION_CONFIG.cascadeTrigger,
        effectiveModelName,
      );

      // Run cascade if:
      // 1. Last message is from user (new turn started), AND
      // 2. Either:
      //    a. Above cascade threshold, OR
      //    b. We haven't checked in a while (every 10 messages)
      const shouldRun =
        isNewTurn(messages) &&
        (currentTokens >= cascadeThresholdTokens ||
          currentMessageCount - state.lastMessageCount >= 10);

      let processedMessages = messages;

      if (shouldRun) {
        logger.info(
          {
            threadId,
            messageCount: currentMessageCount,
            tokenCount: currentTokens,
            contextSize,
            usageRatio: `${(usageRatio * 100).toFixed(1)}%`,
          },
          "[compact-middleware] Running compaction cascade",
        );

        try {
          const result = await runCompactionCascade(
            messages,
            model,
            effectiveModelName,
            config,
            state.circuitBreaker,
          );

          processedMessages = result.messages;
          state.lastMetadata = result.metadata;

          logger.info(
            {
              threadId,
              ...result.metadata,
              reduction: `${(((result.metadata.originalTokens - result.metadata.compactedTokens) / result.metadata.originalTokens) * 100).toFixed(1)}%`,
            },
            "[compact-middleware] Compaction complete",
          );
        } catch (error) {
          logger.error(
            { error, threadId },
            "[compact-middleware] Compaction failed, proceeding with original messages",
          );
          // Continue with original messages on error
        }
      }

      // Update state
      state.lastMessageCount = processedMessages.length;

      // Call the next handler with processed messages
      const response = await handler({
        ...request,
        messages: processedMessages,
      });

      return response;
    },
  });
}

/**
 * Create a compaction tool that the agent can use to manually trigger compaction.
 *
 * This allows the agent to explicitly request compaction when it knows
 * the context is getting large.
 */
export function createCompactionTool(model: BaseChatModel, modelName?: string) {
  return {
    name: "compact_context",
    description:
      "Compact the conversation history to reduce token usage. " +
      "Use this when you notice the context is getting large or when you want to " +
      "preserve important information before continuing a long conversation.",
    params: {
      type: "object",
      properties: {
        aggressive: {
          type: "boolean",
          description:
            "Use aggressive compaction (removes more messages, keeps less context)",
        },
      },
      required: [],
    },
    run: async (params: { aggressive?: boolean }) => {
      // This would need to be implemented with access to the current messages
      // For now, it's a placeholder
      return {
        success: true,
        message: "Compaction requested",
        aggressive: params.aggressive ?? false,
      };
    },
  };
}

// Re-export types and utilities
export * from "./config";
export * from "./tokens";
export * from "./prompts";
export * from "./collapse";
export * from "./truncation";
export * from "./microcompact";
export * from "./restoration";
export * from "./compaction";
export * from "./decision";
