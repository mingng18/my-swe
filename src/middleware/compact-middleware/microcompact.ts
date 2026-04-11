/**
 * Microcompaction utilities.
 *
 * Clears stale tool results based on time gaps.
 * This is a free operation (no LLM call) that runs every turn.
 *
 * Ported from: https://github.com/emanueleielo/compact-middleware
 */

import type { BaseMessage } from "@langchain/core/messages";
import type { MicrocompactConfig } from "./config";
import type { ToolResultInfo } from "./config";

/**
 * Extract timestamp from a message.
 */
function getMessageTimestamp(message: BaseMessage): number {
  // Try to get timestamp from additional_kwargs
  const timestamp = (message as any).additional_kwargs?.timestamp;
  if (timestamp && typeof timestamp === "number") {
    return timestamp;
  }

  // Try created_at
  const createdAt = (message as any).created_at;
  if (createdAt && typeof createdAt === "number") {
    return createdAt;
  }

  // Default to current time
  return Date.now();
}

/**
 * Get tool name from a message.
 */
function getToolNameFromMessage(message: BaseMessage): string | undefined {
  if (message.getType() === "tool" || message.getType() === "tool-result") {
    return (message as any).name;
  }
  return undefined;
}

/**
 * Find all tool result messages with their timestamps.
 */
function findToolResults(
  messages: BaseMessage[],
): Array<{ index: number; message: BaseMessage; toolName: string | undefined; timestamp: number }> {
  const results: Array<{
    index: number;
    message: BaseMessage;
    toolName: string | undefined;
    timestamp: number;
  }> = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const messageType = msg.getType();

    if (messageType === "tool" || messageType === "tool-result") {
      results.push({
        index: i,
        message: msg,
        toolName: getToolNameFromMessage(msg),
        timestamp: getMessageTimestamp(msg),
      });
    }
  }

  return results;
}

/**
 * Calculate time gap between messages in minutes.
 */
function calculateTimeGapMinutes(timestamp1: number, timestamp2: number): number {
  const diff = Math.abs(timestamp2 - timestamp1);
  return diff / (1000 * 60);
}

/**
 * Check if a tool result is compactable based on configuration.
 */
function isCompactableTool(
  toolName: string | undefined,
  config: MicrocompactConfig,
): boolean {
  if (!toolName) return false;
  const compactableTools = config.compactableTools;
  if (!compactableTools || compactableTools.size === 0) return true;
  return compactableTools.has(toolName);
}

/**
 * Clear tool result content.
 */
function clearToolResult(message: BaseMessage): BaseMessage {
  return {
    ...message,
    content: `[Tool result cleared by microcompaction to save tokens. Original content was ${message.content?.toString().length || 0} characters.]`,
  } as BaseMessage;
}

/**
 * Apply microcompaction to clear stale tool results.
 *
 * @param messages - Messages to microcompact
 * @param config - Microcompaction configuration
 * @param currentTime - Current timestamp (default: Date.now())
 * @returns Microcompacted messages and cleared tool info
 */
export function microcompactMessages(
  messages: BaseMessage[],
  config: MicrocompactConfig,
  currentTime: number = Date.now(),
): {
  messages: BaseMessage[];
  clearedTools: ToolResultInfo[];
} {
  if (!config.enabled) {
    return { messages, clearedTools: [] };
  }

  const gapThreshold = config.gapThresholdMinutes ?? 60;
  const keepRecent = config.keepRecent ?? 5;
  const clearedTools: ToolResultInfo[] = [];

  // Find all tool results
  const toolResults = findToolResults(messages);

  if (toolResults.length === 0) {
    return { messages, clearedTools: [] };
  }

  // Always keep the most recent N tool results
  const recentResults = new Set(
    toolResults.slice(-keepRecent).map((tr) => tr.index),
  );

  // Find tool results to clear based on time gaps
  const indicesToClear = new Set<number>();

  for (let i = 0; i < toolResults.length - 1; i++) {
    const current = toolResults[i];
    const next = toolResults[i + 1];

    // Skip if this is a recent result
    if (recentResults.has(current.index)) {
      continue;
    }

    // Check time gap
    const gapMinutes = calculateTimeGapMinutes(current.timestamp, next.timestamp);

    if (gapMinutes > gapThreshold) {
      // Check if this tool is compactable
      if (isCompactableTool(current.toolName, config)) {
        indicesToClear.add(current.index);
        clearedTools.push({
          index: current.index,
          toolName: current.toolName || "unknown",
          timestamp: current.timestamp,
          cleared: true,
        });
      }
    }
  }

  if (indicesToClear.size === 0) {
    return { messages, clearedTools: [] };
  }

  // Create new message array with cleared tool results
  const result = messages.map((msg, idx) =>
    indicesToClear.has(idx) ? clearToolResult(msg) : msg,
  );

  return {
    messages: result,
    clearedTools,
  };
}

/**
 * Count how many tool results would be cleared.
 */
export function countMicrocompactableMessages(
  messages: BaseMessage[],
  config: MicrocompactConfig,
  currentTime: number = Date.now(),
): number {
  const gapThreshold = config.gapThresholdMinutes ?? 60;
  const keepRecent = config.keepRecent ?? 5;

  const toolResults = findToolResults(messages);
  if (toolResults.length === 0) return 0;

  const recentResults = new Set(
    toolResults.slice(-keepRecent).map((tr) => tr.index),
  );

  let count = 0;
  for (let i = 0; i < toolResults.length - 1; i++) {
    const current = toolResults[i];
    const next = toolResults[i + 1];

    if (recentResults.has(current.index)) continue;

    const gapMinutes = calculateTimeGapMinutes(current.timestamp, next.timestamp);

    if (gapMinutes > gapThreshold && isCompactableTool(current.toolName, config)) {
      count++;
    }
  }

  return count;
}

/**
 * Add timestamp to messages that don't have one.
 * This should be called when messages are created.
 */
export function addTimestampToMessage(message: BaseMessage): BaseMessage {
  const existing = (message as any).additional_kwargs?.timestamp;
  if (existing) return message;

  return {
    ...message,
    additional_kwargs: {
      ...(message as any).additional_kwargs || {},
      timestamp: Date.now(),
    },
  } as BaseMessage;
}
