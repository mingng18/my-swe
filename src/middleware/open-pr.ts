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
  findExistingPr,
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

function shellEscapeSingleQuotes(input: string): string {
  return `'${input.replace(/'/g, `'"'"'`)}'`;
}

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
  error?: string;
  pushSucceeded?: boolean;
  prCreated?: boolean;
}

/**
 * Extract commit_and_open_pr tool result payload from messages.
 */
export function extractPrParamsFromMessages(
  messages: BaseMessage[],
): PrPayload | null {
  // Iterate in reverse to find the most recent tool RESULT (not tool call)
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    const content = msg.content;
    const name = msg.name;
    const type = msg.type;

    // Tool results have type === "tool" AND name === tool name
    if (type === "tool" && name === "commit_and_open_pr" && content) {
      logger.debug(
        { index: i, name, contentType: typeof content, content },
        "Found commit_and_open_pr tool result",
      );
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
          logger.debug({ parsed }, "Parsed prPayload");
          return parsed;
        }
      } catch {
        // Ignore JSON parse errors
      }
    }
  }

  logger.debug(
    {
      messageCount: messages.length,
      messageTypes: messages.map((m) => ({ type: m.type, name: m.name })),
    },
    "No commit_and_open_pr tool result found in messages",
  );
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

  const result: OpenPrResult = {
    pushSucceeded: false,
    prCreated: false,
  };

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
      logger.info(
        { prPayload },
        "commit_and_open_pr already succeeded, skipping middleware",
      );
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
    await gitFetchOrigin(sandboxBackend, workingRepoDir);
    const hasUnpushedCommits = await gitHasUnpushedCommits(
      sandboxBackend,
      workingRepoDir,
    );

    const hasChanges = hasUncommittedChanges || hasUnpushedCommits;

    if (!hasChanges) {
      logger.info(
        { threadId, repo: `${repoOwner}/${repoName}` },
        "No changes detected, skipping PR creation",
      );
      return null;
    }

    logger.info(
      {
        threadId,
        repo: `${repoOwner}/${repoName}`,
        hasUncommittedChanges,
        hasUnpushedCommits,
      },
      "Changes detected, preparing PR",
    );

    const branchName = config.metadata?.branch_name;
    const currentBranch = await gitCurrentBranch(
      sandboxBackend,
      workingRepoDir,
    );
    const targetBranch = branchName || `open-swe/${threadId}`;

    // Resolve GitHub token early for both idempotency check and push/PR creation
    let githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
    if (!githubToken && threadId) {
      const [threadToken] = await getGithubTokenFromThread(threadId);
      githubToken = threadToken?.trim() || "";
    }

    // Early idempotency check: see if PR already exists for this branch
    // This avoids unnecessary git operations if PR is already open
    if (repoOwner && githubToken) {
      try {
        const existingPr = await findExistingPr(
          repoOwner,
          repoName,
          repoOwner,
          githubToken,
          targetBranch,
        );
        if (existingPr && existingPr[0]) {
          logger.info(
            {
              threadId,
              repo: `${repoOwner}/${repoName}`,
              branch: targetBranch,
              prUrl: existingPr[0],
              prNumber: existingPr[1],
            },
            "PR already exists, skipping creation",
          );
          return null;
        }
      } catch (err) {
        // Don't fail on early check - continue with normal flow
        logger.warn(
          {
            error: err,
            repo: `${repoOwner}/${repoName}`,
            branch: targetBranch,
          },
          "Early PR check failed, continuing with normal flow",
        );
      }
    }

    // Checkout or create branch with better error handling
    if (currentBranch !== targetBranch) {
      try {
        if (branchName) {
          // Existing branch — try checkout first, if fails create it
          await sandboxBackend.execute(
            `cd ${shellEscapeSingleQuotes(
              workingRepoDir,
            )} && git checkout ${shellEscapeSingleQuotes(targetBranch)} 2>/dev/null || git checkout -b ${shellEscapeSingleQuotes(targetBranch)}`,
          );
        } else {
          await gitCheckoutBranch(sandboxBackend, workingRepoDir, targetBranch);
        }
        // Verify checkout succeeded
        const actualBranch = await gitCurrentBranch(
          sandboxBackend,
          workingRepoDir,
        );
        if (actualBranch !== targetBranch) {
          logger.error(
            { threadId, expected: targetBranch, actual: actualBranch },
            "Branch checkout failed",
          );
          return {
            error: `Branch checkout failed: expected ${targetBranch}, got ${actualBranch}`,
          };
        }
      } catch (err) {
        logger.error(
          { error: err, threadId, targetBranch },
          "Failed to checkout branch",
        );
        return {
          error: `Failed to checkout branch ${targetBranch}: ${err instanceof Error ? err.message : String(err)}`,
        };
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
    await gitAddAll(sandboxBackend, workingRepoDir);
    await gitCommit(sandboxBackend, workingRepoDir, commitMessage);

    // Partial failure recovery: track push success separately from PR creation
    let pushSucceeded = false;
    if (githubToken) {
      try {
        await gitPush(
          sandboxBackend,
          workingRepoDir,
          targetBranch,
          githubToken,
        );
        pushSucceeded = true;
        result.pushSucceeded = true;
        logger.info(
          { threadId, repo: `${repoOwner}/${repoName}`, branch: targetBranch },
          "Git push succeeded",
        );
      } catch (pushErr) {
        const pushErrorMsg =
          pushErr instanceof Error ? pushErr.message : String(pushErr);
        logger.error(
          {
            error: pushErr,
            threadId,
            repo: `${repoOwner}/${repoName}`,
            branch: targetBranch,
          },
          "Git push failed - aborting PR creation",
        );
        return {
          error: `Git push failed: ${pushErrorMsg}`,
          pushSucceeded: false,
          prCreated: false,
        };
      }

      // Only create PR if push succeeded
      if (pushSucceeded && repoOwner) {
        try {
          await createGithubPr(
            repoOwner,
            repoName,
            githubToken,
            prTitle,
            targetBranch,
            prBody,
          );
          result.prCreated = true;
          logger.info(
            {
              threadId,
              repo: `${repoOwner}/${repoName}`,
              branch: targetBranch,
            },
            "PR created successfully",
          );
        } catch (prErr) {
          const prErrorMsg =
            prErr instanceof Error ? prErr.message : String(prErr);
          logger.error(
            {
              error: prErr,
              threadId,
              repo: `${repoOwner}/${repoName}`,
              branch: targetBranch,
            },
            "PR creation failed (but push succeeded)",
          );
          // Return partial success info so caller knows what happened
          return {
            error: `PR creation failed: ${prErrorMsg}`,
            pushSucceeded: true,
            prCreated: false,
          };
        }
      }
    }

    logger.info(
      {
        threadId,
        repo: `${repoOwner}/${repoName}`,
        pushSucceeded,
        prCreated: result.prCreated,
      },
      "After-agent middleware completed successfully",
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const threadId = config.configurable?.thread_id;
    const repoConfig = config.configurable?.repo;
    const repoOwner = repoConfig?.owner;
    const repoName = repoConfig?.name;
    logger.error(
      {
        error,
        threadId,
        repo: repoOwner && repoName ? `${repoOwner}/${repoName}` : undefined,
        branch: config.metadata?.branch_name,
      },
      "Error in after-agent middleware",
    );
    // Return gracefully instead of crashing the server
    return {
      error: errorMsg,
      pushSucceeded: result.pushSucceeded,
      prCreated: result.prCreated,
    };
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
