import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { mergeGithubPr } from "../utils/github";

/**
 * Merge a GitHub PR by number.
 *
 * This tool merges an existing pull request using the GitHub API.
 * If merge fails (including merge conflicts), the error is returned
 * so the agent can decide how to proceed.
 */
export const mergePrTool = tool(
  async ({ pr_number }, config) => {
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
          "Missing GITHUB_TOKEN in host environment. Cannot merge pull requests without authentication.",
      });
    }

    try {
      const result = await mergeGithubPr(repoOwner, repoName, githubToken, pr_number);
      return JSON.stringify({
        success: true,
        merged: !!result?.merged,
        message: result?.message ?? "Pull request merged.",
        sha: result?.sha ?? null,
      });
    } catch (error: any) {
      const status = error?.status ?? error?.response?.status ?? null;
      const message =
        error?.response?.data?.message || error?.message || "Failed to merge pull request";

      return JSON.stringify({
        success: false,
        error: message,
        status,
        pr_number,
      });
    }
  },
  {
    name: "merge_pr",
    description:
      "Merge a GitHub pull request by number. Returns merge conflicts/errors to the agent.",
    schema: z.object({
      pr_number: z.number().int().positive().describe("Pull request number to merge"),
    }),
  },
);
