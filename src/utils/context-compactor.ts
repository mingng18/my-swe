import { createLogger } from "./logger";
import type { BaseMessage } from "@langchain/core/messages";

/**
 * Check if a message is protected from compaction.
 * Messages with _protected flag should never be removed.
 */
function isMessageProtected(message: BaseMessage): boolean {
  return (
    (message as any).additional_kwargs?._protected === true ||
    (message as any).kwargs?._protected === true
  );
}

const logger = createLogger("context-compactor");

// Configuration from environment
const CONTEXT_COMPACTION_THRESHOLD = Number.parseInt(
  process.env.CONTEXT_COMPACTION_THRESHOLD || "50000",
  10,
);
const CONTEXT_KEEP_MINIMUM = Number.parseInt(
  process.env.CONTEXT_KEEP_MINIMUM || "30",
  10,
);
const CONTEXT_KEEP_IMPORTANT = Number.parseInt(
  process.env.CONTEXT_KEEP_IMPORTANT || "20",
  10,
);

/**
 * Message importance score
 */
export interface MessageScore {
  message: BaseMessage;
  score: number;
  index: number;
  reason: string;
}

/**
 * Compaction result
 */
export interface CompactionResult {
  messages: BaseMessage[];
  originalCount: number;
  compactedCount: number;
  removedCount: number;
  totalTokens: number;
  summary?: string;
}

/**
 * Estimate token count for a message
 * Uses a rough approximation based on content length
 */
function estimateMessageTokens(message: BaseMessage): number {
  const content = message.content as
    | string
    | Array<{ type: string; text?: string }>;

  let textLength = 0;
  if (typeof content === "string") {
    textLength = content.length;
  } else if (Array.isArray(content)) {
    for (let i = 0; i < content.length; i++) {
      const part = content[i];
      if (part.type === "text" && part.text) {
        textLength += part.text.length;
      }
    }
  }

  // Rough estimate: ~4 characters per token
  return Math.ceil(textLength / 4);
}

/**
 * Calculate importance score for a message.
 * Higher score = more important, should be kept.
 *
 * Scoring rubric:
 * - Protected messages: +100 (never delete - includes skill content)
 * - User messages: +10 (never delete)
 * - Final AI responses: +8
 * - System messages: +5
 * - Successful tool results: +3
 * - Failed tool results: +1
 * - Old messages: decay factor based on age
 */
export function calculateImportance(
  message: BaseMessage,
  index: number,
  totalMessages: number,
): MessageScore {
  let score = 0;
  const reasons: string[] = [];

  // Check for protected messages (highest priority)
  if (isMessageProtected(message)) {
    score += 100;
    reasons.push("protected-message");
  }

  const messageType = message.getType();
  const content = message.content as
    | string
    | Array<{ type: string; text?: string }>;

  // Role-based scoring (skip if already protected)
  if (!isMessageProtected(message)) {
    if (messageType === "human" || messageType === "user") {
      score += 10;
      reasons.push("user-message");
    } else if (messageType === "system") {
      score += 5;
      reasons.push("system-message");
    } else if (messageType === "ai") {
      // AI messages: check if it's a final response (no tool calls)
      const hasToolCalls = (message as any).tool_calls?.length > 0;
      if (!hasToolCalls) {
        score += 8;
        reasons.push("final-ai-response");
      } else {
        score += 2;
        reasons.push("ai-with-tool-calls");
      }
    } else if (messageType === "tool" || messageType === "tool-result") {
      // Tool messages: check if successful
      let isSuccessful = true;

      if (typeof content === "string") {
        // Check for error patterns
        const lowerContent = content.toLowerCase();
        if (
          lowerContent.includes("error:") ||
          lowerContent.includes("failed") ||
          lowerContent.includes("exception") ||
          lowerContent.includes('"error"')
        ) {
          isSuccessful = false;
        }
      } else if (Array.isArray(content)) {
        let textContent = "";
        for (let i = 0; i < content.length; i++) {
          const p = content[i];
          if (p.type === "text" && p.text) {
            if (textContent.length > 0) {
              textContent += " ";
            }
            textContent += p.text;
          }
        }
        textContent = textContent.toLowerCase();

        if (
          textContent.includes("error:") ||
          textContent.includes("failed") ||
          textContent.includes("exception")
        ) {
          isSuccessful = false;
        }
      }

      if (isSuccessful) {
        score += 3;
        reasons.push("successful-tool-result");
      } else {
        score += 1;
        reasons.push("failed-tool-result");
      }
    }
  }

  // Recency bonus: newer messages get a small boost
  const age = totalMessages - index;
  const recencyBonus = Math.max(0, 5 - age / 10);
  score += recencyBonus;
  if (recencyBonus > 0) {
    reasons.push(`recency-${recencyBonus.toFixed(1)}`);
  }

  // Token size penalty: very large messages get slightly lower priority
  const tokenCount = estimateMessageTokens(message);
  if (tokenCount > 5000) {
    score -= 1;
    reasons.push("large-message-penalty");
  }

  return {
    message,
    score,
    index,
    reason: reasons.join(", "),
  };
}

/**
 * Compact messages to fit within a token budget while preserving important messages.
 *
 * Strategy:
 * 1. Always keep user messages (highest priority)
 * 2. Keep the last N messages (recent context)
 * 3. Keep top scoring messages by importance
 * 4. Summarize very old messages if space permits
 *
 * @param messages - Messages to compact
 * @param targetTokens - Target token count (default: CONTEXT_COMPACTION_THRESHOLD)
 * @returns Compaction result with filtered messages
 */
export function compactMessages(
  messages: BaseMessage[],
  targetTokens: number = CONTEXT_COMPACTION_THRESHOLD,
): CompactionResult {
  if (messages.length === 0) {
    return {
      messages: [],
      originalCount: 0,
      compactedCount: 0,
      removedCount: 0,
      totalTokens: 0,
    };
  }

  // Calculate current token count
  let currentTokens = 0;
  for (const msg of messages) {
    currentTokens += estimateMessageTokens(msg);
  }

  // If we're already under the threshold, no compaction needed
  if (currentTokens <= targetTokens) {
    return {
      messages,
      originalCount: messages.length,
      compactedCount: messages.length,
      removedCount: 0,
      totalTokens: currentTokens,
    };
  }

  logger.info(
    { currentTokens, targetTokens, messageCount: messages.length },
    "[context-compactor] Compacting context",
  );

  // Calculate importance scores for all messages
  const scoredMessages: MessageScore[] = messages.map((msg, index) =>
    calculateImportance(msg, index, messages.length),
  );

  // Separate user messages (always keep)
  const userMessages = scoredMessages.filter(
    (s) => s.message.getType() === "human" || s.message.getType() === "user",
  );
  const userIndices = new Set(userMessages.map((s) => s.index));

  // Get last N messages (always keep for continuity)
  const lastN = Math.min(CONTEXT_KEEP_MINIMUM, messages.length);
  const lastIndex = messages.length - lastN;
  const recentIndices = new Set(
    Array.from({ length: lastN }, (_, i) => lastIndex + i),
  );

  // Combine always-keep indices
  const alwaysKeepIndices = new Set<number>();
  for (const idx of userIndices) {
    alwaysKeepIndices.add(idx);
  }
  for (const idx of recentIndices) {
    alwaysKeepIndices.add(idx);
  }

  // Mark messages that are always kept
  const alwaysKept: MessageScore[] = [];
  const remaining: MessageScore[] = [];

  for (const scored of scoredMessages) {
    if (alwaysKeepIndices.has(scored.index)) {
      alwaysKept.push(scored);
    } else {
      remaining.push(scored);
    }
  }

  // Calculate remaining budget
  let alwaysKeptTokens = 0;
  for (const scored of alwaysKept) {
    alwaysKeptTokens += estimateMessageTokens(scored.message);
  }

  const remainingBudget = targetTokens - alwaysKeptTokens;

  // Sort remaining by score (highest first)
  remaining.sort((a, b) => b.score - a.score);

  // Add top scoring messages until we hit budget
  const additionalKept: MessageScore[] = [];
  let additionalTokens = 0;

  for (const scored of remaining) {
    const msgTokens = estimateMessageTokens(scored.message);
    if (additionalTokens + msgTokens <= remainingBudget) {
      additionalKept.push(scored);
      additionalTokens += msgTokens;
    } else if (additionalKept.length < CONTEXT_KEEP_IMPORTANT) {
      // Ensure we keep at least CONTEXT_KEEP_IMPORTANT additional messages
      additionalKept.push(scored);
      additionalTokens += msgTokens;
    } else {
      break;
    }
  }

  // Combine and sort by original index
  const keptScores = [...alwaysKept, ...additionalKept];
  keptScores.sort((a, b) => a.index - b.index);

  const compactedMessages = keptScores.map((s) => s.message);

  logger.info(
    {
      originalCount: messages.length,
      compactedCount: compactedMessages.length,
      removedCount: messages.length - compactedMessages.length,
      originalTokens: currentTokens,
      estimatedTokens: alwaysKeptTokens + additionalTokens,
    },
    "[context-compactor] Compaction complete",
  );

  return {
    messages: compactedMessages,
    originalCount: messages.length,
    compactedCount: compactedMessages.length,
    removedCount: messages.length - compactedMessages.length,
    totalTokens: alwaysKeptTokens + additionalTokens,
  };
}

/**
 * Create a summary of old messages that were removed.
 * This can be used to preserve some context without keeping full messages.
 */
export function summarizeRemovedMessages(removed: BaseMessage[]): string {
  if (removed.length === 0) {
    return "";
  }

  const toolCalls = removed.filter(
    (m) => m.getType() === "tool" || m.getType() === "tool-result",
  ).length;
  const aiMessages = removed.filter((m) => m.getType() === "ai").length;

  const summaryParts: string[] = [
    `[Context compaction: ${removed.length} older messages removed]`,
  ];

  if (toolCalls > 0) {
    summaryParts.push(`- ${toolCalls} tool call results`);
  }
  if (aiMessages > 0) {
    summaryParts.push(`- ${aiMessages} AI responses`);
  }

  return summaryParts.join("\n");
}

/**
 * Check if compaction is needed for a message array.
 */
export function shouldCompact(
  messages: BaseMessage[],
  threshold: number = CONTEXT_COMPACTION_THRESHOLD,
): boolean {
  let totalTokens = 0;
  for (const msg of messages) {
    totalTokens += estimateMessageTokens(msg);
  }
  return totalTokens > threshold;
}

/**
 * Progressive compaction that runs in stages.
 * First stage: gentle compaction (keeps more)
 * Later stages: aggressive compaction (keeps less)
 */
export function progressiveCompaction(
  messages: BaseMessage[],
  targetTokens: number,
): CompactionResult {
  // Try gentle compaction first (90% of target)
  const gentleResult = compactMessages(messages, targetTokens * 0.9);

  if (gentleResult.totalTokens <= targetTokens) {
    return gentleResult;
  }

  // Still too big, try aggressive compaction (target * 0.8)
  return compactMessages(messages, targetTokens * 0.8);
}
