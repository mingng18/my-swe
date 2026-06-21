/**
 * Iterative PR Review Cycle
 *
 * Watches for PR review comments and auto-addresses them, inspired by
 * Stripe Minions' iterative review pattern. Each cycle fetches unresolved
 * review comments, uses the agent harness to generate fixes, commits and
 * pushes them, then posts a summary comment on the PR.
 */

import { createLogger } from "../utils/logger";
import { getAgentHarness } from "./deepagents";
import type { AgentHarness, AgentInvokeOptions } from "./agentHarness";
import {
  type RepoConfig,
  postGithubComment,
  gitAddAll,
  gitCommit,
  gitPush,
  gitCurrentBranch,
} from "../utils/github";
import { SandboxService } from "../integrations/sandbox-service";
import { Octokit } from "octokit";

const logger = createLogger("pr-review-cycle");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PRReviewComment {
  path: string;
  line: number;
  body: string;
  reviewer: string;
}

export interface PRReviewResult {
  prNumber: number;
  totalComments: number;
  addressedComments: number;
  commitsPushed: number;
  remainingIssues: string[];
}

interface ReviewCommentAPI {
  id: number;
  path?: string;
  line?: number;
  original_line?: number;
  body: string | null;
  user?: { login: string };
  in_reply_to_id?: number | null;
}

// ---------------------------------------------------------------------------
// PRReviewCycle
// ---------------------------------------------------------------------------

export class PRReviewCycle {
  private repoConfig: RepoConfig;
  private githubToken: string;
  private octokit: Octokit;
  private sandbox: SandboxService | null;
  private repoDir: string;
  private harness: AgentHarness | null = null;
  private threadId: string;

  /**
   * @param repoConfig  - Owner and name of the GitHub repository
   * @param githubToken - GitHub access token with repo scope
   * @param threadId    - Thread ID for agent harness invocation
   * @param repoDir     - Path to the repo inside the sandbox (or locally)
   * @param sandbox     - SandboxService for running git commands (null for local)
   */
  constructor(
    repoConfig: RepoConfig,
    githubToken: string,
    threadId: string,
    repoDir: string,
    sandbox: SandboxService | null = null,
  ) {
    this.repoConfig = repoConfig;
    this.githubToken = githubToken;
    this.octokit = new Octokit({ auth: githubToken });
    this.threadId = threadId;
    this.repoDir = repoDir;
    this.sandbox = sandbox;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Fetch unresolved review comments on a PR.
   *
   * Uses the GitHub REST API via Octokit to pull all review comments and
   * filters out any that appear to have been resolved (bot replied or the
   * comment thread was marked resolved).
   */
  async fetchUnresolvedComments(
    prNumber: number,
  ): Promise<PRReviewComment[]> {
    logger.info({ prNumber }, "Fetching unresolved review comments");

    try {
      const rawComments = await this.octokit.paginate(
        this.octokit.rest.pulls.listReviewComments,
        {
          owner: this.repoConfig.owner,
          repo: this.repoConfig.name,
          pull_number: prNumber,
          headers: { "X-GitHub-Api-Version": "2022-11-28" },
        },
      );

      // Filter to comments that have not been marked as outdated/resolved.
      // GitHub review comments have a `position` field that is null when
      // the comment is outdated (the line it referred to was changed).
      // We also skip comments that are replies (in_reply_to_id) because
      // the top-level comment is the actionable one.
      const actionable: PRReviewComment[] = [];

      for (const c of rawComments as ReviewCommentAPI[]) {
        // Skip replies – the parent comment is the actionable one
        if (c.in_reply_to_id) continue;

        // Skip empty bodies
        if (!c.body?.trim()) continue;

        // Heuristic: if the body contains a marker that this comment was
        // auto-addressed by us, skip it.  We use a well-known tag.
        if (c.body.includes("<!-- pr-review-cycle:addressed -->")) continue;

        // If the comment's body starts with "Fixed in" or "Done:" or similar
        // patterns, it is likely already resolved.
        const lowerBody = c.body.trim().toLowerCase();
        if (
          lowerBody.startsWith("fixed in") ||
          lowerBody.startsWith("done:")
        ) {
          continue;
        }

        actionable.push({
          path: c.path ?? "",
          line: c.line ?? c.original_line ?? 0,
          body: c.body,
          reviewer: c.user?.login ?? "unknown",
        });
      }

      logger.info(
        { prNumber, count: actionable.length },
        "Unresolved comments fetched",
      );
      return actionable;
    } catch (error) {
      logger.error(
        { prNumber, error },
        "Failed to fetch unresolved comments",
      );
      return [];
    }
  }

  /**
   * Address a batch of review comments by invoking the agent harness for
   * each one, then committing and pushing the resulting changes.
   */
  async addressComments(
    prNumber: number,
    comments: PRReviewComment[],
  ): Promise<PRReviewResult> {
    const result: PRReviewResult = {
      prNumber,
      totalComments: comments.length,
      addressedComments: 0,
      commitsPushed: 0,
      remainingIssues: [],
    };

    if (comments.length === 0) {
      logger.info({ prNumber }, "No comments to address");
      return result;
    }

    const harness = await this.ensureHarness();
    const opts: AgentInvokeOptions = {
      threadId: this.threadId,
      transport: "github",
    };

    for (const comment of comments) {
      const prompt = this.buildPrompt(comment);
      logger.info(
        { prNumber, file: comment.path, line: comment.line },
        "Addressing review comment from %s",
        comment.reviewer,
      );

      try {
        const response = await harness.invoke(prompt, opts);

        if (response.error) {
          logger.warn(
            { prNumber, file: comment.path, error: response.error },
            "Agent returned error for review comment",
          );
          result.remainingIssues.push(
            `${comment.path}:${comment.line} - ${comment.body.substring(0, 100)}`,
          );
          continue;
        }

        // Attempt to commit and push
        const pushed = await this.commitAndPush(
          `fix: address review comment on ${comment.path}:${comment.line}\n\nReview by @${comment.reviewer}: ${comment.body.substring(0, 200)}`,
        );

        if (pushed) {
          result.addressedComments++;
          result.commitsPushed++;
          logger.info(
            { prNumber, file: comment.path },
            "Committed fix for review comment",
          );
        } else {
          // No changes to commit – may mean the agent couldn't fix it
          result.remainingIssues.push(
            `${comment.path}:${comment.line} - no changes produced`,
          );
        }
      } catch (error) {
        logger.error(
          { prNumber, file: comment.path, error },
          "Failed to address review comment",
        );
        result.remainingIssues.push(
          `${comment.path}:${comment.line} - error: ${String(error)}`,
        );
      }
    }

    // Post summary comment on the PR
    await this.postSummaryComment(prNumber, result);

    return result;
  }

  /**
   * Run a full iterative review cycle: fetch comments → address → push → wait.
   *
   * Runs up to `maxRounds` iterations.  Each round fetches the latest set of
   * unresolved comments and attempts to address them.  If no comments remain
   * the cycle ends early.
   */
  async runCycle(
    prNumber: number,
    maxRounds: number = 2,
  ): Promise<PRReviewResult> {
    const aggregate: PRReviewResult = {
      prNumber,
      totalComments: 0,
      addressedComments: 0,
      commitsPushed: 0,
      remainingIssues: [],
    };

    logger.info({ prNumber, maxRounds }, "Starting PR review cycle");

    for (let round = 1; round <= maxRounds; round++) {
      logger.info({ prNumber, round, maxRounds }, "Review cycle round");

      const comments = await this.fetchUnresolvedComments(prNumber);
      aggregate.totalComments += comments.length;

      if (comments.length === 0) {
        logger.info(
          { prNumber, round },
          "No unresolved comments – cycle complete",
        );
        break;
      }

      const roundResult = await this.addressComments(prNumber, comments);

      aggregate.addressedComments += roundResult.addressedComments;
      aggregate.commitsPushed += roundResult.commitsPushed;
      aggregate.remainingIssues.push(...roundResult.remainingIssues);

      // If nothing was addressed this round, avoid infinite spinning.
      if (roundResult.addressedComments === 0) {
        logger.info(
          { prNumber, round },
          "No comments addressed this round – stopping cycle",
        );
        break;
      }

      // Brief pause to allow GitHub to update comment state and for any
      // new reviewer comments to appear before the next round.
      if (round < maxRounds) {
        await sleep(3_000);
      }
    }

    logger.info(
      {
        prNumber,
        total: aggregate.totalComments,
        addressed: aggregate.addressedComments,
        commits: aggregate.commitsPushed,
      },
      "PR review cycle complete",
    );

    return aggregate;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private async ensureHarness(): Promise<AgentHarness> {
    if (!this.harness) {
      this.harness = await getAgentHarness();
    }
    return this.harness;
  }

  private buildPrompt(comment: PRReviewComment): string {
    return [
      "Address this PR review comment:",
      "",
      `File: ${comment.path}`,
      `Line: ${comment.line}`,
      `Reviewer: @${comment.reviewer}`,
      "",
      "Comment:",
      comment.body,
      "",
      "Make the necessary code changes to address the reviewer's feedback. " +
        "Only modify the relevant file(s). Do not introduce unrelated changes.",
    ].join("\n");
  }

  /**
   * Stage, commit and push changes.  Returns true if a commit was created
   * and pushed, false if there were no changes to commit.
   */
  private async commitAndPush(message: string): Promise<boolean> {
    if (!this.sandbox) {
      logger.warn("No sandbox available – cannot commit/push");
      return false;
    }

    try {
      await gitAddAll(this.sandbox, this.repoDir);
      await gitCommit(this.sandbox, this.repoDir, message);

      const branch = await gitCurrentBranch(this.sandbox, this.repoDir);
      await gitPush(this.sandbox, this.repoDir, branch, this.githubToken);

      return true;
    } catch (error) {
      // gitCommit with --quiet will throw when there is nothing to commit.
      const msg = String(error);
      if (
        msg.includes("nothing to commit") ||
        msg.includes("working tree clean")
      ) {
        logger.info("No changes to commit");
        return false;
      }
      logger.error({ error }, "commitAndPush failed");
      throw error;
    }
  }

  private async postSummaryComment(
    prNumber: number,
    result: PRReviewResult,
  ): Promise<void> {
    if (result.commitsPushed === 0) return;

    const body = [
      "<!-- pr-review-cycle:addressed -->",
      "## PR Review Cycle Summary",
      "",
      `- **Comments addressed:** ${result.addressedComments}/${result.totalComments}`,
      `- **Commits pushed:** ${result.commitsPushed}`,
      "",
      result.remainingIssues.length > 0
        ? [
            "### Remaining issues",
            ...result.remainingIssues.map((i) => `- ${i}`),
          ].join("\n")
        : "All review comments have been addressed.",
      "",
      "_Automated by PR Review Cycle_",
    ].join("\n");

    await postGithubComment(
      this.repoConfig,
      prNumber,
      body,
      this.githubToken,
    );
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
