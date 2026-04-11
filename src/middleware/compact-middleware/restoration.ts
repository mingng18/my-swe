/**
 * Post-compaction restoration utilities.
 *
 * Re-reads important files and restores plan state after compaction.
 *
 * Ported from: https://github.com/emanueleielo/compact-middleware
 */

import type { BaseMessage } from "@langchain/core/messages";
import type { RestorationConfig } from "./config";

/**
 * File reference extracted from messages.
 */
export interface FileReference {
  /** File path */
  path: string;
  /** Message index where it was read */
  index: number;
  /** Timestamp when read */
  timestamp: number;
}

/**
 * Plan reference extracted from messages.
 */
export interface PlanReference {
  /** Plan content */
  content: string;
  /** Message index where it was created */
  index: number;
}

/**
 * Extract file references from tool calls and results.
 */
export function extractFileReferences(
  messages: BaseMessage[],
): FileReference[] {
  const references: FileReference[] = [];
  const seenPaths = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Check tool calls for file operations
    const toolCalls = (msg as any).tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        if (tc.name === "read_file" && tc.args?.path) {
          const path = tc.args.path as string;
          if (!seenPaths.has(path)) {
            seenPaths.add(path);
            references.push({
              path,
              index: i,
              timestamp:
                (msg as any).additional_kwargs?.timestamp || Date.now(),
            });
          }
        }
        if (
          (tc.name === "edit_file" || tc.name === "write_file") &&
          tc.args?.file_path
        ) {
          const path = tc.args.file_path as string;
          if (!seenPaths.has(path)) {
            seenPaths.add(path);
            references.push({
              path,
              index: i,
              timestamp:
                (msg as any).additional_kwargs?.timestamp || Date.now(),
            });
          }
        }
      }
    }

    // Check tool results for file content
    const messageType = msg.getType();
    if (messageType === "tool" || messageType === "tool-result") {
      const toolName = (msg as any).name;
      if (toolName === "read_file") {
        // Try to extract path from content or name
        const content = msg.content;
        if (typeof content === "string") {
          // Look for file path patterns
          const pathMatch = content.match(/^[\w/\\.-]+\.[\w]+$/m);
          if (pathMatch && !seenPaths.has(pathMatch[0])) {
            seenPaths.add(pathMatch[0]);
            references.push({
              path: pathMatch[0],
              index: i,
              timestamp:
                (msg as any).additional_kwargs?.timestamp || Date.now(),
            });
          }
        }
      }
    }
  }

  // Sort by recency (most recent first)
  return references.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Extract plan references from system messages or AI responses.
 */
export function extractPlanReferences(
  messages: BaseMessage[],
): PlanReference[] {
  const plans: PlanReference[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Check for plan in system messages
    if (msg.getType() === "system") {
      const content = msg.content;
      if (typeof content === "string") {
        // Look for plan-like content
        if (
          content.includes("## Plan") ||
          content.includes("### Steps") ||
          content.includes("1.") ||
          content.toLowerCase().includes("task list")
        ) {
          plans.push({
            content,
            index: i,
          });
        }
      }
    }

    // Check for plan in AI messages
    if (msg.getType() === "ai") {
      const toolCalls = (msg as any).tool_calls;
      // AI messages without tool calls might contain plan summaries
      if (!toolCalls || toolCalls.length === 0) {
        const content = msg.content;
        if (typeof content === "string" && content.length > 200) {
          // Check if it looks like a plan or task list
          if (
            content.includes("##") ||
            content.includes("- [") ||
            /^\d+\./m.test(content)
          ) {
            plans.push({
              content,
              index: i,
            });
          }
        }
      }
    }
  }

  return plans;
}

/**
 * Create restoration messages for files.
 *
 * This simulates re-reading files by creating tool result messages
 * with the file content. In a real implementation, this would call
 * the actual read_file tool.
 */
export function createFileRestorationMessages(
  files: Array<{ path: string; content: string }>,
  config: RestorationConfig,
): BaseMessage[] {
  const messages: BaseMessage[] = [];
  const perFileChars = config.perFileChars ?? 10000;

  for (const file of files) {
    // Truncate content if too large
    let content = file.content;
    if (content.length > perFileChars) {
      content =
        content.slice(0, perFileChars) +
        `\n\n... [truncated, ${content.length - perFileChars} more chars]`;
    }

    messages.push({
      type: "tool" as const,
      name: "read_file",
      content,
      tool_call_id: `restoration_${file.path.replace(/[^a-zA-Z0-9]/g, "_")}`,
    } as any);
  }

  return messages;
}

/**
 * Calculate restoration budget.
 */
export function calculateRestorationBudget(
  files: FileReference[],
  config: RestorationConfig,
): { files: FileReference[]; estimatedChars: number } {
  const maxFiles = config.maxFiles ?? 5;
  const fileBudget = config.fileBudgetChars ?? 30000;

  // Take the most recent files up to maxFiles
  const selectedFiles = files.slice(0, maxFiles);

  // Estimate character budget (rough estimate)
  const estimatedChars = selectedFiles.length * (config.perFileChars ?? 10000);

  return {
    files: selectedFiles,
    estimatedChars: Math.min(estimatedChars, fileBudget),
  };
}

/**
 * Create a plan restoration message.
 */
export function createPlanRestorationMessage(plan: PlanReference): BaseMessage {
  return {
    type: "system" as const,
    content: `[Active Plan Restored]\n\n${plan.content}\n\n---\n\n[Note: This plan was restored from the pre-compaction conversation state.]`,
  } as any;
}

/**
 * Apply restoration to compacted messages.
 *
 * @param messages - Compacted messages
 * @param config - Restoration configuration
 * @param readFileFn - Optional function to actually read files
 * @returns Messages with restoration applied
 */
export function applyRestoration(
  messages: BaseMessage[],
  config: RestorationConfig,
  readFileFn?: (path: string) => Promise<string>,
): { messages: BaseMessage[]; restoredFiles: string[]; restoredPlan: boolean } {
  if (!config.enabled) {
    return { messages, restoredFiles: [], restoredPlan: false };
  }

  const result = [...messages];
  const restoredFiles: string[] = [];

  // Restore files
  const fileRefs = extractFileReferences(messages);
  const { files: filesToRestore } = calculateRestorationBudget(
    fileRefs,
    config,
  );

  if (filesToRestore.length > 0) {
    // In a real implementation, we would call readFileFn for each file
    // For now, create placeholder messages
    for (const fileRef of filesToRestore) {
      // This would be replaced with actual file content
      const content = `[File restoration placeholder for: ${fileRef.path}]`;

      result.push({
        type: "tool" as const,
        name: "read_file",
        content,
        tool_call_id: `restoration_${Date.now()}_${fileRef.index}`,
      } as any);

      restoredFiles.push(fileRef.path);
    }
  }

  // Restore plan
  let restoredPlan = false;
  if (config.restorePlans ?? true) {
    const plans = extractPlanReferences(messages);
    if (plans.length > 0) {
      // Use the most recent plan
      const plan = plans[0];
      result.push(createPlanRestorationMessage(plan));
      restoredPlan = true;
    }
  }

  return {
    messages: result,
    restoredFiles,
    restoredPlan,
  };
}

/**
 * Get a summary of what was restored.
 */
export function getRestorationSummary(
  restoredFiles: string[],
  restoredPlan: boolean,
): string {
  const parts: string[] = [];

  if (restoredFiles.length > 0) {
    parts.push(
      `Restored ${restoredFiles.length} files: ${restoredFiles.join(", ")}`,
    );
  }

  if (restoredPlan) {
    parts.push("Restored active plan state");
  }

  if (parts.length === 0) {
    return "";
  }

  return `[Post-Compaction Restoration]\n${parts.join("\n")}\n`;
}
