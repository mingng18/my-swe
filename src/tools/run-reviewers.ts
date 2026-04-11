import { tool } from "@langchain/core/tools";
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

    // Get workspace directory from sandbox
    const workspaceDir = sandbox?.getWorkspaceDir?.();
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

      const result = await runGit(sandbox, workspaceDir, gitCommand);

      if (result.exitCode !== 0) {
        return JSON.stringify({
          error: `Failed to get ${scope} files: ${result.error || result.output}`,
        });
      }

      const files = result.output
        .split("\n")
        .filter(Boolean)
        .map((file) => file.trim());

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
      const reviewerResults = [];
      let allIssues: ReviewIssue[] = [];
      let criticalFound = false;

      for (const reviewerName of reviewerNames) {
        const reviewerConfig = builtInSubagents.find(
          (agent) => agent.name === reviewerName,
        );

        if (!reviewerConfig) {
          reviewerResults.push({
            name: reviewerName,
            status: "error",
            error: "Reviewer configuration not found",
          });
          continue;
        }

        try {
          // Create a deep agent for this reviewer
          const { createDeepAgent } = await import("deepagents");
          const agent = createDeepAgent({
            name: reviewerName,
            systemPrompt: reviewerConfig.systemPrompt,
            tools: reviewerConfig.tools || [],
            backend: sandbox,
          });

          // Run the review
          const result = await agent.invoke({
            input: `Review these files for quality, security, and maintainability:\n\n${files.join("\n")}`,
            configurable: { thread_id: threadId },
          });

          // Parse the output
          const issues = parseReviewerOutput(result.reply);
          allIssues.push(...issues);

          if (hasCriticalIssues(issues)) {
            criticalFound = true;
          }

          reviewerResults.push({
            name: reviewerName,
            status: "success",
            issues_count: issues.length,
            critical_issues: hasCriticalIssues(issues),
            summary:
              issues.length === 0
                ? "No issues found"
                : `${issues.length} issues detected`,
          });
        } catch (error) {
          reviewerResults.push({
            name: reviewerName,
            status: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      // Generate summary
      const summary = reviewerResults
        .map((r) => `${r.name}: ${r.summary}`)
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
