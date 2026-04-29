import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createLogger } from "../utils/logger";

const logger = createLogger("pr-review-tool");

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

    // TODO: Implement PR file fetching
    // TODO: Implement reviewer selection and execution
    // TODO: Implement review comment posting

    logger.info({ pr_number }, "[pr_review] PR review tool not yet fully implemented");

    return JSON.stringify({
      success: false,
      error: "PR review tool not yet fully implemented",
    });
  },
  {
    name: "pr_review",
    description: "Run reviewer subagents on a GitHub PR and post feedback as a review comment",
    schema: z.object({
      pr_number: z.number().int().positive().describe("Pull request number to review"),
    }),
  }
);
