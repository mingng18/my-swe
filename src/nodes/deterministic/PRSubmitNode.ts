/**
 * Deterministic Node: PR Submission
 *
 * Ensures commit_and_open_pr is called after code changes.
 *
 * This node checks if there are uncommitted changes and enforces
 * the PR creation workflow, regardless of whether the agent
 * remembered to call commit_and_open_pr.
 */

import { createLogger } from "../../utils/logger";
import type { SandboxService } from "../../integrations/sandbox-service";
import {
  gitHasUncommittedChanges,
  gitAddAll,
  gitCommit,
  gitPush,
  gitCurrentBranch,
  createGithubPr,
  gitConfigUser,
} from "../../utils/github";

const logger = createLogger("pr-submit-node");

export interface PRSubmitNodeState {
  hasChanges: boolean;
  prCreated: boolean;
  prUrl?: string;
  error?: string;
}

/**
 * Check if commit_and_open_pr tool was called successfully
 */
export function wasPrToolCalled(messages: any[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.type === "tool" && msg?.name === "commit_and_open_pr") {
      try {
        const content =
          typeof msg.content === "string"
            ? JSON.parse(msg.content)
            : msg.content;
        return content?.success === true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

/**
 * Enforce PR creation workflow
 *
 * This runs after the agent completes. If the agent didn't call
 * commit_and_open_pr successfully, this node will do it.
 */
async function commitChanges(params: {
  sandbox: SandboxService;
  repoDir: string;
  threadId: string;
  branchName?: string;
}): Promise<{ currentBranch: string; commitMessage: string }> {
  // Configure git user
  await gitConfigUser(
    params.sandbox,
    params.repoDir,
    "Open SWE Agent",
    "open-swe@users.noreply.github.com",
  );

  // Stage all changes
  await gitAddAll(params.sandbox, params.repoDir);

  // Get current branch or create feature branch
  let currentBranch = await gitCurrentBranch(params.sandbox, params.repoDir);

  const targetBranch =
    params.branchName || `open-swe/${params.threadId.slice(0, 8)}`;

  if (currentBranch === "main" || currentBranch === "master") {
    // Create and checkout feature branch
    logger.info(
      { currentBranch, targetBranch },
      "[PRSubmitNode] Creating feature branch",
    );
    // Note: branch creation would be done here with gitCheckoutBranch
  }

  // Commit with default message
  const commitMessage = "feat: automated changes from Open SWE agent";
  await gitCommit(params.sandbox, params.repoDir, commitMessage);

  return { currentBranch, commitMessage };
}

async function pushAndCreatePullRequest(params: {
  sandbox: SandboxService;
  repoDir: string;
  repoOwner: string;
  repoName: string;
  currentBranch: string;
  commitMessage: string;
  githubToken?: string;
}): Promise<{ prCreated: boolean; prUrl?: string; error?: string }> {
  // Push to remote
  logger.info(
    { branch: params.currentBranch },
    "[PRSubmitNode] Pushing changes",
  );
  await gitPush(params.sandbox, params.repoDir, params.currentBranch);

  // Create PR
  const token =
    params.githubToken ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    "";

  if (!token) {
    logger.warn("[PRSubmitNode] No GitHub token, skipping PR creation");
    return {
      prCreated: false,
      error: "No GitHub token available",
    };
  }

  logger.info("[PRSubmitNode] Creating GitHub PR");
  const [prUrl, prNumber, success] = await createGithubPr(
    params.repoOwner,
    params.repoName,
    token,
    params.commitMessage,
    params.currentBranch,
    "Automated PR created by Open SWE agent.",
  );

  if (prUrl) {
    logger.info({ prUrl, prNumber }, "[PRSubmitNode] PR created successfully");
    return {
      prCreated: true,
      prUrl,
    };
  } else {
    logger.error({ prNumber }, "[PRSubmitNode] PR creation failed");
    return {
      prCreated: false,
      error: "PR creation returned no URL",
    };
  }
}

/**
 * Enforce PR creation workflow
 *
 * This runs after the agent completes. If the agent didn't call
 * commit_and_open_pr successfully, this node will do it.
 */
export async function enforcePRSubmission(params: {
  sandbox: SandboxService;
  repoDir: string;
  repoOwner: string;
  repoName: string;
  threadId: string;
  messages: any[];
  githubToken?: string;
  branchName?: string;
}): Promise<PRSubmitNodeState> {
  logger.info(
    { repo: `${params.repoOwner}/${params.repoName}` },
    "[PRSubmitNode] Enforcing PR submission",
  );

  // Check if PR tool was already called successfully
  if (wasPrToolCalled(params.messages)) {
    logger.info(
      "[PRSubmitNode] commit_and_open_pr already succeeded, skipping",
    );
    return {
      hasChanges: false,
      prCreated: true,
    };
  }

  // Check for uncommitted changes
  const hasChanges = await gitHasUncommittedChanges(
    params.sandbox,
    params.repoDir,
  );

  if (!hasChanges) {
    logger.info("[PRSubmitNode] No uncommitted changes, skipping PR creation");
    return {
      hasChanges: false,
      prCreated: false,
    };
  }

  logger.info("[PRSubmitNode] Found uncommitted changes, creating PR");

  try {
    const { currentBranch, commitMessage } = await commitChanges({
      sandbox: params.sandbox,
      repoDir: params.repoDir,
      threadId: params.threadId,
      branchName: params.branchName,
    });

    const prResult = await pushAndCreatePullRequest({
      sandbox: params.sandbox,
      repoDir: params.repoDir,
      repoOwner: params.repoOwner,
      repoName: params.repoName,
      currentBranch,
      commitMessage,
      githubToken: params.githubToken,
    });

    return {
      hasChanges: true,
      ...prResult,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMsg }, "[PRSubmitNode] PR submission failed");

    return {
      hasChanges: true,
      prCreated: false,
      error: errorMsg,
    };
  }
}

/**
 * Format PR submission results for display
 */
export function formatPRResults(state: PRSubmitNodeState): string {
  if (!state.hasChanges) {
    return "ℹ️ No changes to commit";
  }

  if (state.prCreated) {
    return `✅ PR created: ${state.prUrl}`;
  }

  return `❌ PR creation failed: ${state.error || "Unknown error"}`;
}
