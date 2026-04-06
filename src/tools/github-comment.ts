import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { postGithubComment } from "../utils/github/index";
import { getGithubTokenFromThread } from "../utils/github/github-token";
import { createLogger } from "../utils/logger";

const logger = createLogger("github-comment-tool");

/**
 * Post a comment to a GitHub PR or issue.
 */
export const githubCommentTool = tool(
  async ({ issue_number, body }, config) => {
    const threadId = config?.configurable?.thread_id;
    const repoOwner = config?.configurable?.repo?.owner;
    const repoName = config?.configurable?.repo?.name;

    if (!repoOwner || !repoName) {
      return JSON.stringify({
        success: false,
        error: "Repository configuration missing.",
      });
    }

    let githubToken = process.env.GITHUB_TOKEN?.trim() || "";
    if (!githubToken && threadId) {
      const [threadToken] = await getGithubTokenFromThread(threadId);
      githubToken = threadToken?.trim() || "";
    }

    if (!githubToken) {
      return JSON.stringify({
        success: false,
        error: "Missing GITHUB_TOKEN. Cannot post comments without authentication.",
      });
    }

    try {
      const success = await postGithubComment(
        { owner: repoOwner, name: repoName },
        issue_number,
        body,
        githubToken
      );

      if (success) {
        logger.info({ issue_number }, "[github_comment] Comment posted successfully.");
        return JSON.stringify({ success: true });
      } else {
        return JSON.stringify({ success: false, error: "Failed to post comment. Check logs." });
      }
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error?.message || "Failed to post comment.",
      });
    }
  },
  {
    name: "github_comment",
    description: "Post a comment to a GitHub PR or issue.",
    schema: z.object({
      issue_number: z.number().int().positive().describe("Pull request or issue number"),
      body: z.string().describe("Content of the comment (markdown supported)"),
    }),
  }
);
