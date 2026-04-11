/**
 * LLM-based summarization for compaction.
 *
 * Uses the 9-section structured prompt to create comprehensive summaries.
 *
 * Ported from: https://github.com/emanueleielo/compact-middleware
 */

import type { BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  COMPACTION_SUMMARY_PROMPT,
  createSummaryMessage,
  augmentPromptWithInstructions,
  extractNextStep,
} from "./prompts";
import { countMessagesTokens } from "./tokens";
import type { CompactionConfig } from "./config";
import { createLogger } from "../../utils/logger";

const logger = createLogger("compact-middleware:compaction");

/**
 * Convert messages to a format suitable for summarization.
 */
function messagesToString(messages: BaseMessage[]): string {
  const parts: string[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const type = msg.getType();
    const content = msg.content;

    let msgStr = `[${type.toUpperCase()}] `;

    if (typeof content === "string") {
      msgStr += content;
    } else if (Array.isArray(content)) {
      const textParts = content
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text as string);
      msgStr += textParts.join(" ");
    }

    // Add tool call info
    const toolCalls = (msg as any).tool_calls;
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      const callInfo = toolCalls
        .map((tc: { name?: string; args?: Record<string, unknown> }) => {
          const argsStr =
            tc.args && Object.keys(tc.args).length > 0
              ? `(${JSON.stringify(tc.args).slice(0, 100)}...)`
              : "";
          return `${tc.name || "unknown"}${argsStr}`;
        })
        .join(", ");
      msgStr += `\n[Tool calls: ${callInfo}]`;
    }

    parts.push(msgStr);
  }

  return parts.join("\n\n---\n\n");
}

/**
 * Generate a summary using the LLM.
 */
export async function generateSummary(
  messages: BaseMessage[],
  model: BaseChatModel,
  config: CompactionConfig,
): Promise<string> {
  let prompt = COMPACTION_SUMMARY_PROMPT;

  // Add custom instructions if provided
  if (config.customInstructions) {
    prompt = augmentPromptWithInstructions(prompt, config.customInstructions);
  }

  // Add conversation context
  const conversationText = messagesToString(messages);
  const fullPrompt = `${prompt}\n\n## Conversation to Summarize\n\n${conversationText}`;

  try {
    // Call the LLM to generate summary
    const response = await model.invoke([
      new SystemMessage(prompt),
      new HumanMessage(
        `Please summarize the following conversation:\n\n${conversationText}`,
      ),
    ]);

    const summary = response.content as string;
    return summary;
  } catch (error) {
    logger.error({ error }, "[compaction] Failed to generate summary");
    throw error;
  }
}

/**
 * Compact messages using LLM summarization.
 *
 * @param messages - Messages to compact
 * @param model - LLM to use for summarization
 * @param config - Compaction configuration
 * @returns Compacted messages with summary
 */
export async function compactWithSummary(
  messages: BaseMessage[],
  model: BaseChatModel,
  config: CompactionConfig,
): Promise<{
  messages: BaseMessage[];
  summary: string;
  originalTokens: number;
  compactedTokens: number;
}> {
  const originalTokens = countMessagesTokens(messages);

  logger.info(
    {
      messageCount: messages.length,
      originalTokens,
    },
    "[compaction] Starting LLM summarization",
  );

  // Generate the summary
  const summary = await generateSummary(messages, model, config);

  // Keep the last N messages (from config)
  const keepConfig = config.keep;
  const keepCount =
    keepConfig?.type === "messages"
      ? keepConfig.value
      : typeof keepConfig === "number"
        ? keepConfig
        : 10;

  const messagesToKeep = messages.slice(-Math.max(1, keepCount));

  // Create summary message
  const summaryMsg = createSummaryMessage(summary);

  // Combine: summary + recent messages
  const compacted: BaseMessage[] = [summaryMsg, ...messagesToKeep];

  const compactedTokens = countMessagesTokens(compacted);

  logger.info(
    {
      originalCount: messages.length,
      compactedCount: compacted.length,
      originalTokens,
      compactedTokens,
      reduction: ((originalTokens - compactedTokens) / originalTokens) * 100,
    },
    "[compaction] LLM summarization complete",
  );

  return {
    messages: compacted,
    summary,
    originalTokens,
    compactedTokens,
  };
}

/**
 * Partial compaction - compact only the prefix or suffix.
 *
 * Useful when only part of the conversation needs compaction.
 */
export async function partialCompaction(
  messages: BaseMessage[],
  model: BaseChatModel,
  config: CompactionConfig,
  mode: "prefix" | "suffix" = "prefix",
): Promise<{
  messages: BaseMessage[];
  summary: string;
}> {
  const keepCount = config.keep?.type === "messages" ? config.keep.value : 10;

  if (mode === "prefix") {
    // Compact the first N messages, keep the rest
    const splitPoint = Math.max(0, messages.length - keepCount);
    const toCompact = messages.slice(0, splitPoint);
    const toKeep = messages.slice(splitPoint);

    if (toCompact.length === 0) {
      return { messages, summary: "" };
    }

    const result = await compactWithSummary(toCompact, model, config);

    return {
      messages: [...result.messages, ...toKeep],
      summary: result.summary,
    };
  } else {
    // Compact the last N messages, keep the beginning
    const splitPoint = Math.min(keepCount, messages.length);
    const toKeep = messages.slice(0, splitPoint);
    const toCompact = messages.slice(splitPoint);

    if (toCompact.length === 0) {
      return { messages, summary: "" };
    }

    const result = await compactWithSummary(toCompact, model, config);

    return {
      messages: [...toKeep, ...result.messages],
      summary: result.summary,
    };
  }
}

/**
 * Extract the next step from a summary for resumption.
 */
export function getNextStepFromSummary(summary: string): string | undefined {
  return extractNextStep(summary);
}

/**
 * Create a resumption prompt after compaction.
 */
export function createResumptionPrompt(
  summary: string,
  suppressFollowUp: boolean,
): string {
  const nextStep = extractNextStep(summary);

  let prompt = "\n\n[Context Compaction Complete]\n\n";
  prompt +=
    "The conversation history has been compacted to manage context length. ";
  prompt +=
    "All critical information has been preserved in the summary above.\n\n";

  if (nextStep && !suppressFollowUp) {
    prompt += `Based on the summary, the next step is:\n\n${nextStep}\n\n`;
    prompt += "Please continue from where we left off.";
  } else if (!suppressFollowUp) {
    prompt +=
      "Please continue with the next appropriate step based on the 'Current Work' section.";
  }

  return prompt;
}
