import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { Octokit } from "octokit";
import { createLogger } from "../utils/logger";
import { cachedGithubApiCall } from "../utils/github/github-cache";
import { postGithubComment } from "../utils/github/index";
import { getReviewersForFiles } from "../subagents/reviewerMapping";
import { getSandboxBackendSync } from "../utils/sandboxState";
import {
  parseReviewerOutput,
  hasCriticalIssues,
  type ReviewIssue,
} from "../subagents/reviewerParser";

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

    try {
      const files = await fetchPrFiles(repoOwner, repoName, pr_number, githubToken);

      logger.info(
        { pr_number, fileCount: files.length },
        "[pr_review] Successfully fetched PR files"
      );

      // Extract filenames from PR files
      const filenames = files.map((f) => f.filename);

      // Get reviewers for these files based on file patterns
      const selectedReviewers = getReviewersForFiles(filenames);

      logger.info(
        { pr_number, fileCount: files.length, reviewers: selectedReviewers },
        "[pr_review] Selected reviewers for PR"
      );

      // Check if we have reviewers to run
      if (selectedReviewers.length === 0) {
        return JSON.stringify({
          success: true,
          message: "No applicable reviewers found for the files in this PR",
          issues: [],
          has_critical: false,
          summary: "No reviewers applicable",
          reviewer_results: [],
        });
      }

      // Get sandbox backend (optional for PR review)
      const sandbox = getSandboxBackendSync(threadId);

      // Lazy import to avoid circular dependency
      const { builtInSubagents } = await import("../subagents/registry");

      // Prepare file context for reviewers
      const fileContext = files
        .filter((f) => f.patch) // Only include files with patches
        .map((f) => `
File: ${f.filename} (${f.status})
${f.patch}`)
        .join("\n");

      if (!fileContext.trim()) {
        return JSON.stringify({
          success: true,
          message: "No file patches available for review (files may be binary or too large)",
          issues: [],
          has_critical: false,
          summary: "No reviewable content",
          reviewer_results: [],
        });
      }

      // Create and run reviewers in parallel
      const reviewerPromises = selectedReviewers.map(async (reviewerName) => {
        const reviewerConfig = builtInSubagents.find(
          (agent) => agent.name === reviewerName
        );

        if (!reviewerConfig) {
          return {
            name: reviewerName,
            status: "error",
            error: "Reviewer configuration not found",
          };
        }

        try {
          // Create a deep agent for this reviewer
          const { createDeepAgent } = await import("deepagents");
          const agent = createDeepAgent({
            name: reviewerName,
            systemPrompt: reviewerConfig.systemPrompt,
            tools: reviewerConfig.tools || [],
            ...(sandbox && { backend: sandbox as any }), // Only include backend if sandbox exists
          });

          // Prepare review prompt with PR context
          const reviewPrompt = `Review the following pull request changes:

PR #${pr_number} in ${repoOwner}/${repoName}

Files changed:
${filenames.join("\n")}

Please review these changes for quality, security, and maintainability issues. Focus on the actual code changes in the diffs below.

${fileContext}

Provide your feedback in the following format for each issue found:
[SEVERITY]
File: path/to/file
Issue: description of the issue
Fix: suggested fix or improvement

Severity levels: LOW, MEDIUM, HIGH, CRITICAL`;

          // Run the review
          const result = await agent.invoke(
            { messages: [{ role: "user", content: reviewPrompt }] },
            { configurable: { thread_id: threadId } }
          );

          // Parse the output
          const lastMsg = result.messages[result.messages.length - 1];
          const reply = typeof lastMsg?.content === "string" ? lastMsg.content : "";
          const issues = parseReviewerOutput(reply);

          return {
            name: reviewerName,
            status: "success",
            issues_count: issues.length,
            critical_issues: hasCriticalIssues(issues),
            issues,
            summary:
              issues.length === 0
                ? "No issues found"
                : `${issues.length} issues detected`,
          };
        } catch (error) {
          logger.error(
            { pr_number, reviewer: reviewerName, error },
            "[pr_review] Reviewer execution failed"
          );

          return {
            name: reviewerName,
            status: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      });

      // Wait for all reviewers to complete
      const reviewerResults = await Promise.all(reviewerPromises);

      // Aggregate all issues
      const allIssues: ReviewIssue[] = [];
      let criticalFound = false;

      for (const result of reviewerResults) {
        if (result.status === "success" && result.issues) {
          allIssues.push(...result.issues);
          if (result.critical_issues) {
            criticalFound = true;
          }
        }
      }

      // Generate summary
      const summary = reviewerResults
        .map((r) => `${r.name}: ${r.summary || r.error || "Failed"}`)
        .join("\n");

      logger.info(
        {
          pr_number,
          reviewersRun: selectedReviewers.length,
          totalIssues: allIssues.length,
          criticalFound,
        },
        "[pr_review] Review completed"
      );

      // Format review results as markdown comment
      let reviewComment = `## 🤖 PR Review Results\n\n`;
      reviewComment += `**PR #${pr_number}** in \`${repoOwner}/${repoName}\`\n\n`;
      reviewComment += `### Summary\n\n${summary}\n\n`;

      if (allIssues.length > 0) {
        reviewComment += `### Issues Found (${allIssues.length})\n\n`;

        // Group issues by severity
        const issuesBySeverity: Record<string, ReviewIssue[]> = {
          CRITICAL: [],
          HIGH: [],
          MEDIUM: [],
          LOW: [],
        };

        for (const issue of allIssues) {
          if (issuesBySeverity[issue.severity]) {
            issuesBySeverity[issue.severity].push(issue);
          }
        }

        // Display issues by severity level
        for (const severity of ["CRITICAL", "HIGH", "MEDIUM", "LOW"]) {
          const issues = issuesBySeverity[severity];
          if (issues.length > 0) {
            const emoji = severity === "CRITICAL" ? "🚨" : severity === "HIGH" ? "⚠️" : severity === "MEDIUM" ? "⚡" : "ℹ️";
            reviewComment += `#### ${emoji} ${severity} (${issues.length})\n\n`;
            for (const issue of issues) {
              reviewComment += `- **${issue.file}**: ${issue.issue}\n`;
              if (issue.fix) {
                reviewComment += `  - 💡 Suggested fix: ${issue.fix}\n`;
              }
            }
            reviewComment += `\n`;
          }
        }
      } else {
        reviewComment += `### ✅ No Issues Found\n\n`;
        reviewComment += `All reviewers passed! The code changes look good.\n\n`;
      }

      reviewComment += `---\n`;
      reviewComment += `*Reviewed by: ${selectedReviewers.join(", ")}*\n`;

      // Post the review comment to GitHub
      let commentPosted = false;
      let commentError = "";

      try {
        commentPosted = await postGithubComment(
          { owner: repoOwner, name: repoName },
          pr_number,
          reviewComment,
          githubToken
        );

        if (commentPosted) {
          logger.info(
            { pr_number },
            "[pr_review] Review comment posted successfully"
          );
        } else {
          logger.warn(
            { pr_number },
            "[pr_review] Failed to post review comment"
          );
          commentError = "Failed to post comment (check logs)";
        }
      } catch (error) {
        logger.error(
          { pr_number, error },
          "[pr_review] Error posting review comment"
        );
        commentError = error instanceof Error ? error.message : "Unknown error";
      }

      return JSON.stringify({
        success: true,
        issues: allIssues,
        has_critical: criticalFound,
        summary,
        reviewer_results: reviewerResults,
        comment_posted: commentPosted,
        comment_error: commentError,
      });
    } catch (error) {
      logger.error({ pr_number, error }, "[pr_review] Failed to review PR");

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
