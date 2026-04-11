/**
 * Tool filtering utilities for subagent type configuration.
 *
 * Provides functions to filter tools by name, supporting both allowlist and blocklist patterns.
 * Used to create specialized tool sets for different subagent types (Explore, Plan, General-Purpose).
 */

import { allTools, sandboxAllTools } from "../tools/index";
import type { StructuredTool } from "deepagents";

/**
 * Filter tools by name using allowlist and blocklist patterns.
 *
 * @param allowed - Array of tool names to include (if provided, only these tools are included)
 * @param disallowed - Array of tool names to exclude (these tools are removed from the result)
 * @returns Filtered array of tools
 *
 * @example
 * // Get only read-only tools
 * const readOnlyTools = filterToolsByName(
 *   ["code_search", "semantic_search", "internet_search", "fetch_url"]
 * );
 *
 * @example
 * // Get all tools except commit tools
 * const noCommitTools = filterToolsByName(
 *   undefined,
 *   ["commit_and_open_pr", "merge_pr"]
 * );
 *
 * @example
 * // Disallowed takes precedence over allowed
 * const tools = filterToolsByName(
 *   ["code_search", "commit_and_open_pr"],
 *   ["commit_and_open_pr"]
 * );
 * // Returns only ["code_search"]
 */
export function filterToolsByName(
  allowed?: string[],
  disallowed?: string[],
): StructuredTool[] {
  // Get the appropriate tool array based on environment
  const tools = process.env.USE_SANDBOX === "true" ? sandboxAllTools : allTools;

  let filtered = tools;

  // Apply allowlist if provided
  if (allowed && allowed.length > 0) {
    const allowedSet = new Set(allowed);
    filtered = filtered.filter((tool) => allowedSet.has(tool.name));
  }

  // Apply blocklist if provided (takes precedence)
  if (disallowed && disallowed.length > 0) {
    const disallowedSet = new Set(disallowed);
    filtered = filtered.filter((tool) => !disallowedSet.has(tool.name));
  }

  return filtered;
}

/**
 * Read-only tools for the Explore agent.
 *
 * These tools allow exploration and information gathering but prevent
 * modifications to the codebase or git operations.
 *
 * Read-only tools included:
 * - code_search: Search for patterns across the codebase
 * - semantic_search: Conceptual code search
 * - internet_search: Web search functionality
 * - fetch_url: Fetch and read URLs
 *
 * Excluded tools:
 * - sandbox_shell: Shell command execution
 * - commit_and_open_pr: Git commit and PR creation
 * - merge_pr: PR merging
 */
export const exploreTools = filterToolsByName(
  ["code_search", "semantic_search", "internet_search", "fetch_url"],
  ["sandbox_shell", "commit_and_open_pr", "merge_pr"],
);

/**
 * Tools for the Plan agent.
 *
 * The Plan agent uses the same tool set as Explore, focusing on
 * analysis and planning rather than execution.
 */
export const planTools = exploreTools;

/**
 * All tools for the General-Purpose agent.
 *
 * The General-Purpose agent has access to all available tools,
 * including write operations and git commands.
 */
export const generalPurposeTools = filterToolsByName();

/**
 * Read-only tools for reviewer agents.
 *
 * These tools allow code review and analysis but prevent
 * modifications to the codebase or git operations.
 *
 * Reviewer tools included:
 * - code_search: Search for patterns across the codebase
 * - semantic_search: Conceptual code search
 *
 * Excluded tools:
 * - sandbox_shell: Shell command execution
 * - commit_and_open_pr: Git commit and PR creation
 * - merge_pr: PR merging
 */
export const reviewerTools = filterToolsByName(
  ["code_search", "semantic_search"],
  ["sandbox_shell", "commit_and_open_pr", "merge_pr"],
);
