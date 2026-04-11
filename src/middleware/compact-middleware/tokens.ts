/**
 * Token counting utilities.
 *
 * Uses a hybrid approach:
 * 1. Real API token counts from response_metadata.usage (when available)
 * 2. Heuristic estimation (chars / 4) for messages without real counts
 *
 * Ported from: https://github.com/emanueleielo/compact-middleware
 */

import type { BaseMessage } from "@langchain/core/messages";

/**
 * Token usage from API response.
 */
export interface TokenUsage {
  /** Input tokens */
  input_tokens?: number;
  /** Output tokens */
  output_tokens?: number;
  /** Total tokens */
  total_tokens?: number;
}

/**
 * Token count result.
 */
export interface TokenCount {
  /** Estimated or actual token count */
  tokens: number;
  /** Whether this is a real API count or heuristic */
  isReal: boolean;
}

/**
 * Estimate token count using heuristic (chars / 4).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Extract token usage from a message's response metadata.
 */
export function extractTokenUsage(
  message: BaseMessage,
): TokenUsage | undefined {
  const metadata = (message as any).response_metadata;
  if (!metadata) return undefined;

  const usage = metadata.usage;
  if (!usage) return undefined;

  // Handle various provider formats
  if (usage.input_tokens !== undefined || usage.output_tokens !== undefined) {
    return {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens,
    };
  }

  // OpenAI format
  if (
    usage.prompt_tokens !== undefined ||
    usage.completion_tokens !== undefined
  ) {
    return {
      input_tokens: usage.prompt_tokens,
      output_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
    };
  }

  // Anthropic format
  if (usage.input_tokens !== undefined || usage.output_tokens !== undefined) {
    return {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens,
    };
  }

  return undefined;
}

/**
 * Get content length from a message.
 */
function getMessageContentLength(message: BaseMessage): number {
  const content = message.content;

  if (typeof content === "string") {
    return content.length;
  }

  if (Array.isArray(content)) {
    let length = 0;
    for (const part of content) {
      const p = part as any;
      if (p.type === "text" && p.text) {
        length += p.text.length;
      } else if (p.type === "image_url") {
        // Images cost more, approximate
        length += 1000;
      }
    }
    return length;
  }

  return 0;
}

/**
 * Count tokens for a single message.
 * Uses real API count if available, otherwise heuristic.
 */
export function countMessageTokens(message: BaseMessage): TokenCount {
  // First, try to get real token usage from API response
  const usage = extractTokenUsage(message);

  if (usage) {
    // We have real API token counts
    const total =
      usage.total_tokens ??
      (usage.input_tokens || 0) + (usage.output_tokens || 0);
    if (total > 0) {
      return { tokens: total, isReal: true };
    }
  }

  // Fall back to heuristic estimation
  const contentLength = getMessageContentLength(message);
  return { tokens: estimateTokens(String(contentLength)), isReal: false };
}

/**
 * Count tokens for a message array using hybrid approach.
 *
 * Walks messages backwards to find the last AI message with real API usage.
 * Uses real counts for messages before that point, heuristic for after.
 *
 * @param messages - Messages to count
 * @returns Total token count
 */
export function countMessagesTokens(messages: BaseMessage[]): number {
  if (messages.length === 0) return 0;

  let totalTokens = 0;
  let lastRealIndex = -1;

  // Find the last message with real token usage
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = extractTokenUsage(messages[i]);
    if (usage) {
      const total =
        usage.total_tokens ??
        (usage.input_tokens || 0) + (usage.output_tokens || 0);
      if (total > 0) {
        lastRealIndex = i;
        break;
      }
    }
  }

  if (lastRealIndex === -1) {
    // No real counts found, use heuristic for all
    for (const msg of messages) {
      totalTokens += countMessageTokens(msg).tokens;
    }
    return totalTokens;
  }

  // Use real count for the message with usage metadata
  const realUsage = extractTokenUsage(messages[lastRealIndex]);
  if (realUsage) {
    const realTotal =
      realUsage.total_tokens ??
      (realUsage.input_tokens || 0) + (realUsage.output_tokens || 0);
    totalTokens += realTotal;
  }

  // Use heuristic for messages after the last real count
  for (let i = lastRealIndex + 1; i < messages.length; i++) {
    totalTokens += countMessageTokens(messages[i]).tokens;
  }

  // For messages before the last real count, we can't accurately estimate
  // since we don't have cumulative totals. Use heuristic.
  for (let i = 0; i < lastRealIndex; i++) {
    totalTokens += countMessageTokens(messages[i]).tokens;
  }

  return totalTokens;
}

/**
 * Get context window size for a model.
 */
export function getContextWindowSize(model: string): number {
  // Common context window sizes
  const modelSizes: Record<string, number> = {
    // Claude
    "claude-opus-4-6": 200000,
    "claude-sonnet-4-6": 200000,
    "claude-haiku-4-5-20251001": 200000,
    "claude-3-5-opus": 200000,
    "claude-3-5-sonnet": 200000,
    "claude-3-5-haiku": 200000,
    "claude-3-opus": 200000,
    "claude-3-sonnet": 200000,
    "claude-3-haiku": 200000,

    // GPT
    "gpt-4o": 128000,
    "gpt-4o-mini": 128000,
    "gpt-4-turbo": 128000,
    "gpt-4": 8192,
    "gpt-3.5-turbo": 16385,

    // DeepSeek
    "deepseek-chat": 128000,
    "deepseek-coder": 128000,

    // Default fallback
    default: 128000,
  };

  // Normalize model name
  const normalized = model.toLowerCase().replace(/^anthropic:|^openai:/, "");
  return modelSizes[normalized] || modelSizes.default;
}

/**
 * Calculate threshold in tokens based on trigger format.
 */
export function calculateTokenThreshold(
  trigger: { type: "tokens" | "fraction" | "messages"; value: number },
  model: string,
  messageCount?: number,
): number {
  if (trigger.type === "tokens") {
    return trigger.value;
  }

  if (trigger.type === "fraction") {
    const contextSize = getContextWindowSize(model);
    return Math.floor(contextSize * trigger.value);
  }

  if (trigger.type === "messages" && messageCount !== undefined) {
    // Convert message count to approximate token count
    // Assume average 1000 tokens per message
    return trigger.value * 1000;
  }

  // Default to 85% of context window
  const contextSize = getContextWindowSize(model);
  return Math.floor(contextSize * 0.85);
}

/**
 * Check if compaction should trigger based on current state.
 */
export function shouldTriggerCompaction(
  messages: BaseMessage[],
  trigger: { type: "tokens" | "fraction" | "messages"; value: number },
  model: string,
): boolean {
  if (trigger.type === "messages") {
    return messages.length >= trigger.value;
  }

  const currentTokens = countMessagesTokens(messages);
  const threshold = calculateTokenThreshold(trigger, model, messages.length);
  return currentTokens >= threshold;
}
