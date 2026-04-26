/**
 * Argument truncation utilities.
 *
 * Shortens large tool arguments in old messages to reduce token usage.
 *
 * Ported from: https://github.com/emanueleielo/compact-middleware
 */

import type { BaseMessage } from "@langchain/core/messages";
import type { TruncateArgsConfig } from "./config";

/**
 * Truncate a string value to max length.
 */
function truncateValue(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;

  return `${value.slice(0, maxLength)}… [truncated, ${value.length - maxLength} more chars]`;
}

/**
 * Truncate object values recursively.
 */
function truncateObject(
  obj: Record<string, unknown>,
  maxLength: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // ⚡ Bolt: Replace Object.entries with for...in to avoid intermediate array allocations
  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    const value = obj[key];
    if (typeof value === "string") {
      result[key] = truncateValue(value, maxLength);
    } else if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      result[key] = truncateObject(value as Record<string, unknown>, maxLength);
    } else if (Array.isArray(value)) {
      // Truncate string arrays, keep other arrays as-is
      if (value.length > 0 && typeof value[0] === "string") {
        result[key] = value.map((v) => truncateValue(v, maxLength));
      } else {
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Check if a message has tool calls.
 */
function hasToolCalls(message: BaseMessage): boolean {
  const toolCalls = (message as any).tool_calls;
  return Array.isArray(toolCalls) && toolCalls.length > 0;
}

/**
 * Get tool calls from a message.
 */
function getToolCalls(
  message: BaseMessage,
): Array<{ name?: string; args?: Record<string, unknown>; id?: string }> {
  return (message as any).tool_calls || [];
}

/**
 * Truncate arguments in tool calls.
 */
function truncateToolCallArgs(
  toolCall: { name?: string; args?: Record<string, unknown>; id?: string },
  maxLength: number,
): { name?: string; args?: Record<string, unknown>; id?: string } {
  if (!toolCall.args) return toolCall;

  return {
    ...toolCall,
    args: truncateObject(toolCall.args, maxLength),
  };
}

/**
 * Truncate tool arguments in a message.
 */
function truncateMessageToolArgs(
  message: BaseMessage,
  maxLength: number,
): BaseMessage {
  if (!hasToolCalls(message)) return message;

  const toolCalls = getToolCalls(message);
  const truncatedCalls = toolCalls.map((tc) =>
    truncateToolCallArgs(tc, maxLength),
  );

  // Return a new message with truncated args
  return {
    ...message,
    tool_calls: truncatedCalls,
  } as any;
}

/**
 * Truncate arguments in tool result messages.
 *
 * Tool results can contain large content that should be truncated
 * when they're old (not the most recent).
 */
function truncateToolResultContent(
  message: BaseMessage,
  maxLength: number,
): BaseMessage {
  const messageType = message.getType();
  if (messageType !== "tool" && messageType !== "tool-result") {
    return message;
  }

  const content = message.content;

  if (typeof content === "string") {
    return {
      ...message,
      content: truncateValue(content, maxLength),
    } as any;
  }

  if (Array.isArray(content)) {
    const truncatedContent = content.map((part: any) => {
      if (part.type === "text" && part.text) {
        return {
          ...part,
          text: truncateValue(part.text, maxLength),
        };
      }
      return part;
    });

    return {
      ...message,
      content: truncatedContent,
    } as any;
  }

  return message;
}

/**
 * Truncate large tool arguments and results in messages.
 *
 * @param messages - Messages to truncate
 * @param config - Truncation configuration
 * @param recentCount - Number of recent messages to leave untouched
 * @returns Truncated messages and metadata
 */
export function truncateArguments(
  messages: BaseMessage[],
  config: TruncateArgsConfig,
  recentCount: number = 5,
): { messages: BaseMessage[]; truncatedCount: number } {
  if (!config.enabled) {
    return { messages, truncatedCount: 0 };
  }

  const maxLength = config.maxLength ?? 2000;
  const truncateAll = config.truncateAllTools ?? true;
  const result: BaseMessage[] = [];
  let truncatedCount = 0;

  // Default tools to truncate (write/edit operations)
  const defaultTools = new Set(["write_file", "edit_file", "patch"]);
  const toolsToTruncate = truncateAll ? undefined : defaultTools;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Skip recent messages
    if (i >= messages.length - recentCount) {
      result.push(msg);
      continue;
    }

    let modified = false;
    let newMsg = msg;

    // Truncate tool call arguments
    if (hasToolCalls(msg)) {
      const toolCalls = getToolCalls(msg);
      const shouldTruncate = toolCalls.some((tc) => {
        if (!toolsToTruncate) return true;
        return tc.name && toolsToTruncate.has(tc.name);
      });

      if (shouldTruncate) {
        newMsg = truncateMessageToolArgs(newMsg, maxLength);
        modified = true;
      }
    }

    // Truncate tool result content
    const messageType = msg.getType();
    if (messageType === "tool" || messageType === "tool-result") {
      const toolName = (msg as any).name;

      if (
        toolsToTruncate === undefined ||
        (toolName && toolsToTruncate.has(toolName))
      ) {
        newMsg = truncateToolResultContent(newMsg, maxLength);
        modified = true;
      }
    }

    if (modified) {
      truncatedCount++;
    }

    result.push(newMsg);
  }

  return {
    messages: result,
    truncatedCount,
  };
}

/**
 * Count how many tool arguments would be truncated.
 */
export function countTruncatableArguments(
  messages: BaseMessage[],
  config: TruncateArgsConfig,
  recentCount: number = 5,
): number {
  let count = 0;
  const maxLength = config.maxLength ?? 2000;

  for (let i = 0; i < messages.length - recentCount; i++) {
    const msg = messages[i];

    if (hasToolCalls(msg)) {
      const toolCalls = getToolCalls(msg);
      for (const tc of toolCalls) {
        if (tc.args) {
          const argsStr = JSON.stringify(tc.args);
          if (argsStr.length > maxLength) {
            count++;
            break;
          }
        }
      }
    }

    const messageType = msg.getType();
    if (messageType === "tool" || messageType === "tool-result") {
      const content = msg.content as any;
      const contentLength =
        typeof content === "string"
          ? content.length
          : Array.isArray(content)
            ? content.reduce(
                (sum: number, p: any) => sum + (p.text?.length || 0),
                0,
              )
            : 0;

      if (contentLength > maxLength) {
        count++;
      }
    }
  }

  return count;
}
