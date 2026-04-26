import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createGithubIssue } from "../utils/github";

/**
 * Create a GitHub issue.
 *
 * This tool creates a new issue using the GitHub API.
 * If creation fails, the error is returned so the agent can decide how to proceed.
 *
 * IMPORTANT CITATION REQUIREMENT: After the issue is created, you MUST include
 * a reference to the created issue in your response to the user.
 * Format: "Created issue #123" or "[Issue Title](https://github.com/owner/repo/issues/123)"
 */
export const createGithubIssueTool = tool(
  async ({ title, body }, config) => {
    const repoOwner = config?.configurable?.repo?.owner;
    const repoName = config?.configurable?.repo?.name;
    const githubToken = process.env.GITHUB_TOKEN || "";

    if (!repoOwner || !repoName) {
      return JSON.stringify({
        success: false,
        error:
          "Repository configuration missing. Use --repo owner/name to specify a repository.",
      });
    }

    if (!githubToken) {
      return JSON.stringify({
        success: false,
        error:
          "Missing GITHUB_TOKEN in host environment. Cannot create issues without authentication.",
      });
    }

    try {
      const [issueUrl, issueNumber] = await createGithubIssue(
        repoOwner,
        repoName,
        githubToken,
        title,
        body,
      );

      if (issueUrl && issueNumber) {
        const response = {
          success: true,
          issue_url: issueUrl,
          issue_number: issueNumber,
          title,
        };
        const jsonString = JSON.stringify(response);
        const citationReminder = `\n\nIMPORTANT: When responding to the user, reference the created issue as "Issue #${issueNumber}" or include its URL: ${issueUrl}`;
        return jsonString + citationReminder;
      } else {
        return JSON.stringify({
          success: false,
          error: "Failed to create issue. No URL or number returned.",
        });
      }
    } catch (error: any) {
      const status = error?.status ?? error?.response?.status ?? null;
      const message =
        error?.response?.data?.message ||
        error?.message ||
        "Failed to create issue";

      return JSON.stringify({
        success: false,
        error: message,
        status,
        title,
      });
    }
  },
  {
    name: "create_github_issue",
    description:
      "Create a new GitHub issue. Returns the issue URL and number upon success.",
    schema: z.object({
      title: z.string().describe("Issue title"),
      body: z.string().describe("Issue description/body (markdown supported)"),
    }),
  },
);
