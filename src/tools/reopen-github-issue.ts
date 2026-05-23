import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { reopenGithubIssue } from "../utils/github";

export const reopenGithubIssueTool = tool(
  async ({ issue_number }, config) => {
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
          "Missing GITHUB_TOKEN in host environment. Cannot reopen issues without authentication.",
      });
    }

    try {
      const result = await reopenGithubIssue(
        repoOwner,
        repoName,
        githubToken,
        issue_number,
      );

      if (result.url && result.number) {
        const response = {
          success: true,
          issue_url: result.url,
          issue_number: result.number,
          state: result.state,
        };
        const jsonString = JSON.stringify(response);
        const citationReminder = `\n\nIMPORTANT: When responding to the user, reference the reopened issue as "Issue #${result.number}" or include its URL: ${result.url}`;
        return jsonString + citationReminder;
      } else {
        return JSON.stringify({
          success: false,
          error: "Failed to reopen issue. No URL or number returned.",
        });
      }
    } catch (error: any) {
      const status = error?.status ?? error?.response?.status ?? null;
      const message =
        error?.response?.data?.message ||
        error?.message ||
        "Failed to reopen issue";

      return JSON.stringify({
        success: false,
        error: message,
        status,
        issue_number,
      });
    }
  },
  {
    name: "reopen_github_issue",
    description:
      "Reopen a closed GitHub issue. Returns the issue URL and updated state upon success.",
    schema: z.object({
      issue_number: z
        .number()
        .int()
        .positive()
        .describe("Issue number to reopen"),
    }),
  },
);
