import { createLogger } from "../utils/logger";
import {
  compactMessages,
  progressiveCompaction,
  type CompactionResult,
} from "../utils/context-compactor";
import type { BaseMessage } from "@langchain/core/messages";

const logger = createLogger("progressive-context-edit");

/**
 * Progressive context compaction edit.
 *
 * Replaces the binary ClearToolUsesEdit with intelligent message importance scoring.
 * Instead of dropping all but 5 messages at 100k tokens, this:
 * - Compacts at 50k tokens (configurable)
 * - Always keeps user messages
 * - Always keeps last 30 messages
 * - Keeps top scoring messages by importance
 * - Preserves context through intelligent selection
 */
export class ProgressiveContextEdit {
  private readonly triggerTokens: number;
  private readonly targetTokens: number;

  constructor(options: { triggerTokens?: number; targetTokens?: number } = {}) {
    this.triggerTokens = options.triggerTokens ?? 50000;
    this.targetTokens = options.targetTokens ?? 45000;
  }

  /**
   * Check if this edit should trigger based on current messages.
   */
  shouldTrigger(messages: BaseMessage[]): boolean {
    let totalTokens = 0;
    for (const msg of messages) {
      totalTokens += this.estimateTokens(msg);
    }
    return totalTokens >= this.triggerTokens;
  }

  /**
   * Apply the progressive compaction to messages.
   */
  apply(messages: BaseMessage[]): BaseMessage[] {
    const result = progressiveCompaction(messages, this.targetTokens);

    if (result.removedCount > 0) {
      logger.info(
        {
          originalCount: result.originalCount,
          compactedCount: result.compactedCount,
          removedCount: result.removedCount,
          originalTokens: this.calculateTotalTokens(messages),
          compactedTokens: result.totalTokens,
        },
        "[progressive-context-edit] Applied compaction",
      );
    }

    return result.messages;
  }

  /**
   * Estimate token count for a message.
   */
  private estimateTokens(message: BaseMessage): number {
    const content = message.content as
      | string
      | Array<{ type: string; text?: string }>;

    let textLength = 0;
    if (typeof content === "string") {
      textLength = content.length;
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === "text" && part.text) {
          textLength += part.text.length;
        }
      }
    }

    return Math.ceil(textLength / 4);
  }

  /**
   * Calculate total tokens for all messages.
   */
  private calculateTotalTokens(messages: BaseMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      total += this.estimateTokens(msg);
    }
    return total;
  }
}

/**
 * Create a progressive context edit for use with contextEditingMiddleware.
 * This formats the edit for the middleware API.
 */
export function createProgressiveContextEdit(options?: {
  triggerTokens?: number;
  targetTokens?: number;
}) {
  const edit = new ProgressiveContextEdit(options);
  const triggerTokens = options?.triggerTokens ?? 50000;

  // Return an object with trigger and apply methods as expected by ContextEdit
  return {
    trigger: { tokens: triggerTokens },
    apply: async (params: {
      messages: BaseMessage[];
      countTokens: (messages: BaseMessage[]) => number | Promise<number>;
      model?: unknown;
    }) => {
      try {
        // Apply compaction and modify messages in place
        const compacted = edit.apply(params.messages);
        // Update the messages array reference
        params.messages.splice(0, params.messages.length, ...compacted);
      } catch (error) {
        logger.error(
          { error },
          "[progressive-context-edit] Compaction failed, keeping original messages",
        );
        // Leave messages unchanged on error
      }
    },
  };
}
