import { tool } from "@langchain/core/tools";
import { threadRepoMap } from "../harness/thread-manager";
import { z } from "zod";
import { getSandboxBackendSync } from "../utils/sandboxState";
import { runGit } from "../utils/github/github";
import { getReviewersForFiles } from "../subagents/reviewerMapping";
import {
  parseReviewerOutput,
  hasCriticalIssues,
} from "../subagents/reviewerParser";
import type { ReviewIssue } from "../subagents/reviewerParser";

const scopeSchema = z.enum(["staged", "unstaged", "all"]).default("staged");

const runReviewersSchema = z.object({
  scope: scopeSchema,
});

/**
 * Run multiple reviewer agents on code changes
 *
 * This tool automatically detects which reviewers should run based on the files
 * being reviewed, runs each reviewer in parallel, and aggregates the results.
 *
 * Args:
 *   scope: Which files to review - "staged" (default), "unstaged", or "all"
 *
 * Returns:
 *   JSON object with success status, aggregated issues, and individual reviewer results
 */
export const runReviewersTool = tool(
  async (args, config) => {
    const { scope } = args;
    const threadId = config?.configurable?.thread_id;

    // Check for required context
    if (!threadId) {
      return JSON.stringify({
        error: "Missing thread_id in config",
      });
    }

    const sandbox = getSandboxBackendSync(threadId);
    if (!sandbox) {
      return JSON.stringify({
        error: "No sandbox available - must be run in a sandbox context",
      });
    }

    // Get workspace directory from threadRepoMap
    const repoConfig = threadRepoMap.get(threadId) as
      | { owner?: string; name?: string; workspaceDir?: string }
      | undefined;
    const workspaceDir = repoConfig?.workspaceDir;

    if (!workspaceDir) {
      return JSON.stringify({
        error: "Unable to determine workspace directory",
      });
    }

    // Get list of files to review based on scope
    try {
      let gitCommand: string;

      switch (scope) {
        case "staged":
          gitCommand = "diff --name-only --cached";
          break;
        case "unstaged":
          gitCommand = "diff --name-only";
          break;
        case "all":
          gitCommand = "diff --name-only --cached && git diff --name-only";
          break;
        default:
          gitCommand = "diff --name-only --cached";
      }

      let gitOutput: string;
      try {
        gitOutput = await runGit(sandbox, workspaceDir, gitCommand);
      } catch (err: any) {
        return JSON.stringify({
          error: `Failed to get ${scope} files: ${err.message}`,
        });
      }

      const files = gitOutput
        .split("\n")
        .filter(Boolean)
        .map((file: string) => file.trim());

      if (files.length === 0) {
        return JSON.stringify({
          success: true,
          message: `No ${scope} files found to review`,
          issues: [],
          has_critical: false,
          summary: "No files to review",
          reviewer_results: [],
        });
      }

      // Get reviewers for these files
      const reviewerNames = getReviewersForFiles(files);

      // Lazy import to avoid circular dependency
      const { builtInSubagents } = await import("../subagents/registry");

      // Create and run reviewers
      const { createDeepAgent } = await import("deepagents");

      // ⚡ Bolt Optimization: Replace sequential await loop with Promise.all and array mapping
      // This runs independent reviewer agent invocations concurrently, significantly reducing overall latency.
      const reviewerResults = await Promise.all(
        reviewerNames.map((reviewerName) => {
          const reviewerConfig = builtInSubagents.find(
            (agent) => agent.name === reviewerName,
          );

          if (!reviewerConfig) {
            return Promise.resolve({
              name: reviewerName,
              status: "error",
              error: "Reviewer configuration not found",
            });
          }

          try {
            const agent = createDeepAgent({
              name: reviewerName,
              systemPrompt: reviewerConfig.systemPrompt,
              tools: reviewerConfig.tools || [],
              backend: sandbox as any,
            });

            return agent
              .invoke(
                {
                  messages: [
                    {
                      role: "user",
                      content: `Review these files for quality, security, and maintainability:\n\n${files.join("\n")}`,
                    },
                  ],
                },
                { configurable: { thread_id: `${threadId}-${reviewerName}` } },
              )
              .then((result) => {
                const lastMsg = result.messages[result.messages.length - 1];
                const reply =
                  typeof lastMsg?.content === "string" ? lastMsg.content : "";
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
              })
              .catch((error) => {
                return {
                  name: reviewerName,
                  status: "error",
                  error:
                    error instanceof Error ? error.message : "Unknown error",
                };
              });
          } catch (error) {
            return Promise.resolve({
              name: reviewerName,
              status: "error",
              error: error instanceof Error ? error.message : "Unknown error",
            });
          }
        }),
      );

      // Aggregate all issues after Promise.all resolves to ensure deterministic order
      let allIssues: ReviewIssue[] = [];
      let criticalFound = false;

      for (const result of reviewerResults) {
        if (
          result.status === "success" &&
          "issues" in result &&
          result.issues
        ) {
          allIssues.push(...(result.issues as ReviewIssue[]));
        }
      }

      for (const issue of allIssues) {
        if (hasCriticalIssues([issue])) {
          criticalFound = true;
        }
      }

      // Generate summary
      const summary = reviewerResults
        .map((r) => `${r.name}: ${"summary" in r ? r.summary : r.error}`)
        .join("\n");

      return JSON.stringify({
        success: true,
        issues: allIssues,
        has_critical: criticalFound,
        summary,
        reviewer_results: reviewerResults,
      });
    } catch (error) {
      return JSON.stringify({
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      });
    }
  },
  {
    name: "run_reviewers",
    description:
      "Run multiple reviewer agents on code changes based on file patterns",
    schema: runReviewersSchema,
  },
);
