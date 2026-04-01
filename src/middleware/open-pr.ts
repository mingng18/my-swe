import { shellEscapeSingleQuotes } from "../utils/shell";
/**
 * After-agent middleware that creates a GitHub PR if needed.
 *
 * Runs once after the agent finishes as a safety net. If the agent called
 * `commit_and_open_pr` and it already succeeded, this is a no-op. Otherwise it
 * commits any remaining changes, pushes to a feature branch, and opens a GitHub PR.
 */

import { createLogger } from "../utils/logger";
import {
  createGithubPr,
  gitAddAll,
  gitCheckoutBranch,
  gitCommit,
  gitConfigUser,
  gitCurrentBranch,
  gitFetchOrigin,
  gitHasUncommittedChanges,
  gitHasUnpushedCommits,
  gitPush,
  getGithubTokenFromThread,
  type RepoConfig,
} from "../utils/github";
import type { SandboxService } from "../integrations/sandbox-service";

const logger = createLogger("open-pr-middleware");


/**
 * Message interface from the agent state.
 */
export interface BaseMessage {
  content?: string | Record<string, unknown>;
  name?: string;
  type?: string;
}

/**
 * Agent state interface.
 */
export interface AgentState {
  messages?: BaseMessage[];
  configurable?: Record<string, unknown>;
}

/**
 * Runtime configuration.
 */
export interface RuntimeConfig {
  configurable?: {
    thread_id?: string;
    repo?: Partial<RepoConfig>;
  };
  metadata?: {
    branch_name?: string;
  };
}

/**
 * PR payload extracted from messages.
 */
export interface PrPayload {
  title?: string;
  body?: string;
  commit_message?: string;
  success?: boolean | string;
}

/**
 * Result from the after-agent middleware.
 */
export interface OpenPrResult {
  messages?: BaseMessage[];
}

/**
 * Extract commit_and_open_pr tool result payload from messages.
 */
export function extractPrParamsFromMessages(
  messages: BaseMessage[],
): PrPayload | null {
  // Iterate in reverse to find the most recent tool call
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    const content = msg.content;
    const name = msg.name;

    if (name === "commit_and_open_pr" && content) {
      try {
        let parsed: PrPayload;
        if (typeof content === "string") {
          parsed = JSON.parse(content) as PrPayload;
        } else if (typeof content === "object") {
          parsed = content as PrPayload;
        } else {
          continue;
        }

        if (parsed && typeof parsed === "object") {
          return parsed;
        }
      } catch {
        // Ignore JSON parse errors
      }
    }
  }

  return null;
}

/**
 * After-agent middleware that commits/pushes changes if `commit_and_open_pr` tool didn't.
 *
 * @param state - The current agent state
 * @param config - Runtime configuration
 * @param sandboxBackend - Optional sandbox backend for git operations
 * @param repoDir - Optional repository directory path
 * @returns null if no action needed, otherwise updated state
 */
export async function openPrIfNeeded(
  state: AgentState,
  config: RuntimeConfig,
  sandboxBackend?: SandboxService,
  repoDir?: string,
): Promise<OpenPrResult | null> {
  logger.info("After-agent middleware started");

  try {
    const threadId = config.configurable?.thread_id;
    logger.debug(`Middleware running for thread ${threadId}`);

    const messages = state.messages || [];
    const prPayload = extractPrParamsFromMessages(messages);

    if (!prPayload) {
      logger.info(
        "No commit_and_open_pr tool call found, skipping PR creation",
      );
      return null;
    }

    // Tool already handled commit/push/PR creation
    if ("success" in prPayload && prPayload.success) {
      return null;
    }

    const prTitle = prPayload.title ?? "feat: Open SWE PR";
    const prBody = prPayload.body ?? "Automated PR created by Open SWE agent.";
    const commitMessage = prPayload.commit_message ?? prTitle;

    if (!threadId) {
      throw new Error("No thread_id found in config");
    }

    const repoConfig = config.configurable?.repo;
    const repoOwner = repoConfig?.owner;
    const repoName = repoConfig?.name;

    if (!sandboxBackend || !repoName) {
      logger.info("No sandbox backend or repo name, skipping PR creation");
      return null;
    }

    const workingRepoDir = repoDir || repoName;

    // Check for uncommitted changes
    const hasUncommittedChanges = await gitHasUncommittedChanges(
      sandboxBackend,
      workingRepoDir,
    );

    // Fetch and check for unpushed commits
    await gitFetchOrigin(
      sandboxBackend,
      workingRepoDir,
    );
    const hasUnpushedCommits = await gitHasUnpushedCommits(
      sandboxBackend,
      workingRepoDir,
    );

    const hasChanges = hasUncommittedChanges || hasUnpushedCommits;

    if (!hasChanges) {
      logger.info("No changes detected, skipping PR creation");
      return null;
    }

    logger.info(`Changes detected, preparing PR for thread ${threadId}`);

    const branchName = config.metadata?.branch_name;
    const currentBranch = await gitCurrentBranch(
      sandboxBackend,
      workingRepoDir,
    );
    const targetBranch = branchName || `open-swe/${threadId}`;

    // Checkout or create branch
    if (currentBranch !== targetBranch) {
      if (branchName) {
        // Existing branch — plain checkout, do not create or reset
        const safeTargetBranch = targetBranch;
        const safeWorkingRepoDir = workingRepoDir;
        await sandboxBackend.execute(
          `cd ${shellEscapeSingleQuotes(
            safeWorkingRepoDir,
          )} && git checkout ${shellEscapeSingleQuotes(safeTargetBranch)}`,
        );
      } else {
        await gitCheckoutBranch(
          sandboxBackend,
          workingRepoDir,
          targetBranch,
        );
      }
    }

    // Configure git user
    await gitConfigUser(
      sandboxBackend,
      workingRepoDir,
      "open-swe[bot]",
      "open-swe@users.noreply.github.com",
    );

    // Stage and commit changes
    await gitAddAll(
      sandboxBackend,
      workingRepoDir,
    );
    await gitCommit(
      sandboxBackend,
      workingRepoDir,
      commitMessage,
    );

    // Resolve GitHub token in the same way as the commit_and_open_pr tool:
    // prefer env, then fall back to thread metadata.
    let githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
    if (!githubToken && threadId) {
      const [threadToken] = await getGithubTokenFromThread(threadId);
      githubToken = threadToken?.trim() || "";
    }

    if (githubToken) {
      await gitPush(
        sandboxBackend,
        workingRepoDir,
        targetBranch,
        githubToken,
      );

      if (repoOwner) {
          await createGithubPr(
            repoOwner,
            repoName,
            githubToken,
            prTitle,
            targetBranch,
            prBody,
          );
      }
    }

    logger.info("After-agent middleware completed successfully");
  } catch (error) {
    logger.error({ error }, "Error in after-agent middleware");
    throw error;
  }

  return null;
}

/**
 * Higher-order function that wraps a LangGraph node to handle PR creation after execution.
 *
 * Usage:
 * ```ts
 * const wrappedNode = withOpenPrAfterAgent(originalNode);
 * graph.addNode("myNode", wrappedNode);
 * ```
 */
export function withOpenPrAfterAgent<
  TState extends AgentState,
  TResult = Partial<TState>,
>(
  nodeFn: (state: TState) => Promise<TResult>,
  config?: {
    sandboxBackend?: SandboxService;
    repoDir?: string;
  },
): (state: TState) => Promise<TResult> {
  return async (state: TState): Promise<TResult> => {
    const result = await nodeFn(state);

    // Extract config from state or use provided config
    const runtimeConfig: RuntimeConfig = {
      configurable: (state as unknown as Record<string, unknown>)
        .configurable as Record<string, unknown> | undefined,
      metadata: (state as unknown as Record<string, unknown>).metadata as
        | Record<string, unknown>
        | undefined,
    };

    // Run PR creation middleware
    await openPrIfNeeded(
      state,
      runtimeConfig,
      config?.sandboxBackend,
      config?.repoDir,
    );

    return result;
  };
}
