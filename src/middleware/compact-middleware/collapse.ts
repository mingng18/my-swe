/**
 * Message collapsing utilities.
 *
 * Groups consecutive tool calls of the same type into badge summaries.
 * Reduces token usage while preserving information.
 *
 * Ported from: https://github.com/emanueleielo/compact-middleware
 */

import type { BaseMessage } from "@langchain/core/messages";
import { createBadgeSummary } from "./prompts";
import type { CollapseConfig } from "./config";

/**
 * Tool result group for collapsing.
 */
interface ToolResultGroup {
  /** Tool name */
  toolName: string;
  /** Message indices in the group */
  indices: number[];
  /** Summary of the group */
  summary: string;
}

/**
 * Check if a message is a tool result.
 */
function isToolResult(message: BaseMessage): boolean {
  return message.getType() === "tool" || message.getType() === "tool-result";
}

/**
 * Get the tool name from a tool result message.
 */
function getToolName(message: BaseMessage): string | undefined {
  if (!isToolResult(message)) return undefined;

  // Try name field
  const name = (message as any).name;
  if (name && typeof name === "string") return name;

  // Try tool_call_id to infer tool
  const toolCallId = (message as any).tool_call_id;
  if (toolCallId) {
    // Look for tool name in content
    const content = message.content;
    if (typeof content === "string") {
      // Try to extract from error messages or common patterns
      const match = content.match(/Tool:?\s*(\w+)/);
      if (match) return match[1];
    }
  }

  return "unknown_tool";
}

/**
 * Generate a summary for a group of tool results.
 */
function summarizeGroup(messages: BaseMessage[]): string {
  const summaries: string[] = [];

  for (const msg of messages) {
    const content = msg.content;
    let summary = "";

    if (typeof content === "string") {
      // Take first 100 chars as summary
      summary = content.slice(0, 100);
      if (content.length > 100) summary += "…";
    } else if (Array.isArray(content)) {
      // Concatenate text parts
      const textParts = content
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text as string);
      const joined = textParts.join(" ");
      summary = joined.slice(0, 100);
      if (joined.length > 100) summary += "…";
    }

    summaries.push(summary);
  }

  // Return most common or representative summary
  const summaryCounts = new Map<string, number>();
  for (const s of summaries) {
    summaryCounts.set(s, (summaryCounts.get(s) || 0) + 1);
  }

  let maxCount = 0;
  let maxSummary = "";
  for (const [summary, count] of summaryCounts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      maxSummary = summary;
    }
  }

  return maxSummary || "(multiple results)";
}

/**
 * Find consecutive tool result groups that can be collapsed.
 */
function findCollapsibleGroups(
  messages: BaseMessage[],
  config: CollapseConfig,
): ToolResultGroup[] {
  const groups: ToolResultGroup[] = [];
  let currentGroup: ToolResultGroup | undefined;
  const minSize = config.minGroupSize ?? 2;
  const collapseTools = config.collapseTools ?? new Set();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (!isToolResult(msg)) {
      currentGroup = undefined;
      continue;
    }

    const toolName = getToolName(msg);

    // Skip if not a compactable tool
    if (toolName && collapseTools.size > 0 && !collapseTools.has(toolName)) {
      currentGroup = undefined;
      continue;
    }

    // Start new group or continue existing
    if (!currentGroup || (toolName && currentGroup.toolName !== toolName)) {
      if (currentGroup && currentGroup.indices.length >= minSize) {
        groups.push(currentGroup);
      }
      currentGroup = {
        toolName: toolName || "unknown_tool",
        indices: [i],
        summary: "",
      };
    } else {
      currentGroup.indices.push(i);
    }
  }

  // Don't forget the last group
  if (currentGroup && currentGroup.indices.length >= minSize) {
    groups.push(currentGroup);
  }

  // Generate summaries for each group
  for (const group of groups) {
    const groupMessages = group.indices.map((idx) => messages[idx]);
    group.summary = summarizeGroup(groupMessages);
  }

  return groups;
}

/**
 * Collapse consecutive tool results into badge summaries.
 *
 * @param messages - Messages to collapse
 * @param config - Collapse configuration
 * @returns Collapsed messages and metadata
 */
export function collapseMessages(
  messages: BaseMessage[],
  config: CollapseConfig,
): { messages: BaseMessage[]; collapsedCount: number } {
  if (!config.enabled) {
    return { messages, collapsedCount: 0 };
  }

  const groups = findCollapsibleGroups(messages, config);

  if (groups.length === 0) {
    return { messages, collapsedCount: 0 };
  }

  // Create new message array with collapsed groups
  const result: BaseMessage[] = [];
  const indicesToRemove = new Set<number>();

  for (const group of groups) {
    // Mark indices for removal
    for (const idx of group.indices) {
      indicesToRemove.add(idx);
    }

    // Create collapsed message at the position of the first group member
    const firstIdx = group.indices[0];
    const collapsedMsg: BaseMessage = {
      type: "tool" as const,
      name: group.toolName,
      content: createBadgeSummary(
        group.toolName,
        group.indices.length,
        group.summary,
      ),
      tool_call_id: (messages[firstIdx] as any).tool_call_id || "collapsed",
    } as any;

    // Insert at the first position of the group
    result.push(collapsedMsg);
  }

  // Add messages that weren't collapsed
  for (let i = 0; i < messages.length; i++) {
    if (!indicesToRemove.has(i)) {
      result.push(messages[i]);
    }
  }

  // Sort by original index to maintain order
  result.sort((a, b) => {
    const aIdx = messages.indexOf(a);
    const bIdx = messages.indexOf(b);
    return aIdx - bIdx;
  });

  const collapsedCount = indicesToRemove.size - groups.length;

  return {
    messages: result,
    collapsedCount,
  };
}

/**
 * Count how many messages would be collapsed.
 */
export function countCollapsibleMessages(
  messages: BaseMessage[],
  config: CollapseConfig,
): number {
  const groups = findCollapsibleGroups(messages, config);
  return groups.reduce((sum, group) => sum + group.indices.length - 1, 0);
}
