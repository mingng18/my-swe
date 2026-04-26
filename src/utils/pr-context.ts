/**
 * PR Context utilities for checking existing pull requests.
 *
 * Provides functions to detect if a PR already exists for a thread/branch,
 * allowing the agent to make informed decisions about whether to continue
 * with the current work or start fresh.
 */

import { createLogger } from "./logger";
import { findExistingPr, getGithubDefaultBranch } from "./github/index";
import { threadRepoMap } from "../harness/thread-manager";

const logger = createLogger("pr-context");

export interface PRContext {
  exists: boolean;
  prUrl?: string;
  prNumber?: number;
  branch?: string;
  repo?: { owner: string; name: string };
  message?: string;
}

/**
 * Check if there's an existing PR for the current thread.
 *
 * This helps detect cases where:
 * - The user is reusing a thread that already has an open PR
 * - Previous work was completed but the PR wasn't merged
 * - Multiple agents are working on the same branch
 */
export async function checkExistingPRForThread(
  threadId: string,
  githubToken?: string,
): Promise<PRContext> {
  if (!githubToken) {
    return { exists: false, message: "No GitHub token provided" };
  }

  const repoInfo = threadRepoMap.get(threadId);
  if (!repoInfo) {
    return {
      exists: false,
      message: "No repository associated with this thread",
    };
  }

  const { owner, name, workspaceDir } = repoInfo;

  // Derive the branch name from thread ID (same logic as commit-and-open-pr)
  const branch = `open-swe/${threadId}`;

  try {
    logger.info(
      { threadId, branch, repo: `${owner}/${name}` },
      "[pr-context] Checking for existing PR",
    );

    const existing = await findExistingPr(
      owner,
      name,
      owner,
      githubToken,
      branch,
    );

    if (existing) {
      const [prUrl, prNumber] = existing;
      logger.info(
        { threadId, branch, prUrl, prNumber },
        "[pr-context] Found existing PR for thread",
      );

      return {
        exists: true,
        prUrl: prUrl || undefined,
        prNumber: prNumber || undefined,
        branch,
        repo: { owner, name },
        message: `A pull request already exists for this task: ${prUrl}`,
      };
    }

    logger.info(
      { threadId, branch },
      "[pr-context] No existing PR found for thread",
    );

    return {
      exists: false,
      branch,
      repo: { owner, name },
      message: `No existing PR found. Ready to start new work on branch: ${branch}`,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(
      { threadId, branch, error: errorMsg },
      "[pr-context] Failed to check for existing PR",
    );

    return {
      exists: false,
      branch,
      repo: { owner, name },
      message: `Could not check for existing PRs: ${errorMsg}`,
    };
  }
}

/**
 * Generate a helpful message for the user when an existing PR is detected.
 */
export function formatExistingPRMessage(context: PRContext): string {
  if (!context.exists) {
    return "";
  }

  const { prUrl, prNumber, branch, repo } = context;

  return `
[WARNING] EXISTING PULL REQUEST DETECTED

A pull request already exists for this conversation:
- PR: #${prNumber}
- Branch: ${branch}
- Repository: ${repo?.owner}/${repo?.name}
- URL: ${prUrl}

What would you like to do?
1. Continue working on the existing PR (just make your changes and I'll add them to the same PR)
2. Close the existing PR and start fresh (merge/close the PR first, then send your request again)
3. Start a completely new task (use /new to create a fresh conversation)

If you want to continue with new changes, just describe what you'd like to add or modify and I'll update the existing PR.
`;
}
