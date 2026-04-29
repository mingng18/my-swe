import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { Octokit } from "octokit";
import { createLogger } from "../utils/logger";
import { cachedGithubApiCall } from "../utils/github/github-cache";

const logger = createLogger("pr-review-tool");

/**
 * Represents a file changed in a pull request.
 */
export interface PRFile {
  filename: string;
  status: "added" | "deleted" | "modified" | "renamed";
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

/**
 * Fetch files changed in a pull request using the GitHub API.
 *
 * Uses cached API calls to reduce rate limit consumption.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param prNumber - Pull request number
 * @param token - GitHub access token
 * @returns Array of changed files with metadata
 * @throws Error if API call fails
 */
export async function fetchPrFiles(
  owner: string,
  repo: string,
  prNumber: number,
  token: string
): Promise<PRFile[]> {
  logger.debug({ owner, repo, prNumber }, "[fetchPrFiles] Fetching PR files");

  try {
    const response = await cachedGithubApiCall(
      "GET",
      `repos/${owner}/${repo}/pulls/${prNumber}/files`,
      { owner, repo, prNumber },
      async () => {
        const octokit = new Octokit({ auth: token });
        return await octokit.rest.pulls.listFiles({
          owner,
          repo,
          pull_number: prNumber,
        });
      }
    );

    const files: PRFile[] = response.data.map((file) => ({
      filename: file.filename,
      status: file.status as PRFile["status"],
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch ?? undefined,
    }));

    logger.debug(
      { owner, repo, prNumber, fileCount: files.length },
      "[fetchPrFiles] Successfully fetched PR files"
    );

    return files;
  } catch (error) {
    logger.error(
      { owner, repo, prNumber, error },
      "[fetchPrFiles] Failed to fetch PR files"
    );
    throw error;
  }
}

/**
 * Run reviewer subagents on a GitHub PR and post feedback as a review comment.
 *
 * This tool fetches the files changed in a PR, selects appropriate reviewers
 * based on the file types, runs them in parallel, and posts aggregated feedback
 * as a GitHub review comment.
 *
 * Args:
 *   pr_number: The pull request number to review
 *
 * Returns:
 *   JSON object with success status, review results, and comment posting status
 */
export const prReviewTool = tool(
  async ({ pr_number }, config) => {
    const threadId = config?.configurable?.thread_id;
    const repoOwner = config?.configurable?.repo?.owner;
    const repoName = config?.configurable?.repo?.name;
    const githubToken = process.env.GITHUB_TOKEN;

    if (!repoOwner || !repoName) {
      return JSON.stringify({
        success: false,
        error: "Repository configuration missing.",
      });
    }

    if (!threadId) {
      return JSON.stringify({
        success: false,
        error: "Missing thread_id in config",
      });
    }

    if (!githubToken) {
      return JSON.stringify({
        success: false,
        error: "GITHUB_TOKEN environment variable not set",
      });
    }

    // TODO: Implement reviewer selection and execution
    // TODO: Implement review comment posting

    try {
      const files = await fetchPrFiles(repoOwner, repoName, pr_number, githubToken);

      logger.info(
        { pr_number, fileCount: files.length },
        "[pr_review] Successfully fetched PR files"
      );

      return JSON.stringify({
        success: false,
        error: "PR review tool not yet fully implemented",
        files: files.map((f) => ({
          filename: f.filename,
          status: f.status,
          changes: f.changes,
        })),
      });
    } catch (error) {
      logger.error({ pr_number, error }, "[pr_review] Failed to fetch PR files");

      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
  {
    name: "pr_review",
    description: "Run reviewer subagents on a GitHub PR and post feedback as a review comment",
    schema: z.object({
      pr_number: z.number().int().positive().describe("Pull request number to review"),
    }),
  }
);
