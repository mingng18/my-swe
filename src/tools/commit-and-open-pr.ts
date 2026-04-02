import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  createGithubPr,
  gitAddAll,
  gitCheckoutBranch,
  gitCommit,
  gitPush,
  gitRemoteBranchExists,
  gitConfigUser,
  gitHasUncommittedChanges,
  gitFetchOrigin,
  gitHasUnpushedCommits,
} from "../utils/github/index";
import { getSandboxBackendSync } from "../utils/sandboxState";
import { getGithubTokenFromThread } from "../utils/github/github-token";
import { createLogger } from "../utils/logger";

const logger = createLogger("commit-and-open-pr-tool");

import { shellEscapeSingleQuotes } from "../utils/shell";

function slugifyBranchPart(input: string): string {
  return input
    .toLowerCase()
    .replace(/:/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function buildBranchName(title: string): string {
  const slug = slugifyBranchPart(title)
    .split("-")
    .filter(Boolean)
    .slice(0, 6)
    .join("-");

  const readable = slug || "update";
  const suffix = Date.now().toString().slice(-8);
  return `${readable}-${suffix}`;
}

/**
Commit all current changes and open a GitHub Pull Request.

You MUST call this tool when you have completed your work and want to
submit your changes for review. This is the final step in your workflow.

Before calling this tool, ensure you have:
1. Reviewed your changes for correctness
2. Run `make format` and `make lint` if a Makefile exists in the repo root

## Title Format (REQUIRED — keep under 70 characters)

The PR title MUST follow this exact format:

    <type>: <short lowercase description> [closes <PROJECT_ID>-<ISSUE_NUMBER>]

The description MUST be entirely lowercase (no capital letters).

Where <type> is one of:
- fix:   for bug fixes
- feat:  for new features
- chore: for maintenance tasks (deps, configs, cleanup)
- ci:    for CI/CD changes

The [closes ...] suffix links and auto-closes the Linear ticket.
Use the linear_project_id and linear_issue_number from your context.

Examples:
- "fix: resolve null pointer in user auth [closes AA-123]"
- "feat: add dark mode toggle to settings [closes ENG-456]"
- "chore: upgrade dependencies to latest versions [closes OPS-789]"

## Body Format (REQUIRED)

The PR body MUST follow this exact template:

    ## Description
    <1-3 sentences explaining WHY this PR is needed and the approach taken.
    DO NOT list files changed or enumerate code
    changes — that information is already in the commit history.>

    ## Test Plan
    - [ ] <new test case or manual verification step ONLY for new behavior>

IMPORTANT RULES for the body:
- NEVER add a "Changes:" or "Files changed:" section — it's redundant with git commits
- Test Plan must ONLY include new/novel verification steps, NOT "run existing tests"
    or "verify existing functionality is unaffected" — those are always implied
    If it's a UI change you may say something along the lines of "Test in preview deployment"
- Keep the entire body concise (aim for under 10 lines total)

Example body:

    ## Description
    Fixes the null pointer exception when a user without a profile authenticates.
    The root cause was a missing null check in `getProfile`.

    Resolves AA-123

    ## Test Plan
    - [ ] Verify login works for users without profiles

## Commit Message

The commit message should be concise (1-2 sentences) and focus on the "why"
rather than the "what". Summarize the nature of the changes: new feature,
bug fix, refactoring, etc. If not provided, the PR title is used.

Args:
    title: PR title following the format above (e.g. "fix: resolve auth bug [closes AA-123]")
    body: PR description following the template above with ## Description and ## Test Plan
    commit_message: Optional git commit message. If not provided, the PR title is used.

Returns:
    Dictionary containing:
    - success: Whether the operation completed successfully
    - error: Error string if something failed, otherwise None
    - pr_url: URL of the created PR if successful, otherwise None
    - pr_existing: Whether a PR already existed for this branch
 **/
export const commitAndOpenPrTool = tool(
  async ({ title, body, commit_message }, config) => {
    const threadId = config?.configurable?.thread_id;
    if (!threadId)
      return JSON.stringify({ success: false, error: "Missing thread_id" });

    const repoOwner = config.configurable?.repo?.owner;
    const repoName = config.configurable?.repo?.name;
    const workspaceDir = config.configurable?.repo?.workspaceDir;

    if (!repoOwner || !repoName || !workspaceDir) {
      return JSON.stringify({
        success: false,
        error:
          "Repository configuration missing. Use --repo owner/name to specify a repository.",
      });
    }

    // Sandbox instance
    const sandbox = getSandboxBackendSync(threadId);
    if (!sandbox) {
      return JSON.stringify({
        success: false,
        error: "Sandbox backend not initialized. Is USE_SANDBOX=true set?",
      });
    }

    try {
      // Resolve GitHub token with explicit source for debugging.
      let githubToken = process.env.GITHUB_TOKEN?.trim() || "";
      let tokenSource: "env" | "thread_metadata" | "missing" = githubToken
        ? "env"
        : "missing";
      if (!githubToken) {
        const [threadToken] = await getGithubTokenFromThread(threadId);
        githubToken = threadToken?.trim() || "";
        tokenSource = githubToken ? "thread_metadata" : "missing";
      }
      logger.info(
        { threadId, repo: `${repoOwner}/${repoName}`, tokenSource },
        "[commit_and_open_pr] Resolved GitHub token source",
      );
      if (!githubToken) {
        return JSON.stringify({
          success: false,
          error:
            "GitHub token is missing. Set GITHUB_TOKEN or provide a thread metadata token.",
        });
      }

      await gitConfigUser(
        sandbox,
        workspaceDir,
        "open-swe[bot]",
        "open-swe@users.noreply.github.com",
      );

      // Prefer an explicit branch name from metadata; otherwise follow the
      // open-swe/<thread_id> convention from the Python implementation.
      const metadataBranchName =
        (config as any)?.metadata?.branch_name as string | undefined;
      const targetBranch =
        metadataBranchName && metadataBranchName.trim().length > 0
          ? metadataBranchName.trim()
          : `open-swe/${threadId}`;

      // If a specific branch name is configured, checkout without resetting if it
      // already exists (avoid -B semantics). For the fallback open-swe/<thread_id>
      // branch, we continue to use gitCheckoutBranch which will create/reset it.
      if (metadataBranchName && metadataBranchName.trim().length > 0) {
        const safeBranch = metadataBranchName.trim();
        await sandbox.execute(
          `cd ${shellEscapeSingleQuotes(workspaceDir)} && git checkout ${shellEscapeSingleQuotes(safeBranch)}`,
        );
      } else {
        // Ensure commits are created on the PR branch so push+PR head are valid.
        await gitCheckoutBranch(sandbox, workspaceDir, targetBranch);
      }

      // Detect both uncommitted changes and unpushed commits, matching the Python
      // behavior that proceeds when either exists.
      await gitFetchOrigin(sandbox, workspaceDir);
      const hasUncommittedChanges = await gitHasUncommittedChanges(
        sandbox,
        workspaceDir,
      );
      const hasUnpushedCommits = await gitHasUnpushedCommits(
        sandbox,
        workspaceDir,
      );

      if (!hasUncommittedChanges && !hasUnpushedCommits) {
        return JSON.stringify({
          success: false,
          error: "No changes detected",
        });
      }

      // Only create a new commit when there are uncommitted changes; still allow
      // push + PR creation when there are only unpushed commits.
      if (hasUncommittedChanges) {
        await gitAddAll(sandbox, workspaceDir);
        await gitCommit(sandbox, workspaceDir, commit_message || title);
      }

      try {
        await gitPush(sandbox, workspaceDir, targetBranch, githubToken);
      } catch (error: any) {
        logger.error(
          {
            threadId,
            repo: `${repoOwner}/${repoName}`,
            branch: targetBranch,
            tokenSource,
            error: error?.message || String(error),
          },
          "[commit_and_open_pr] git push failed",
        );
        throw new Error(
          `Push failed for ${repoOwner}/${repoName}:${targetBranch}. ${error?.message || "Unknown push error"}`,
        );
      }
      const branchExistsRemotely = await gitRemoteBranchExists(
        sandbox,
        workspaceDir,
        targetBranch,
      );
      if (!branchExistsRemotely) {
        return JSON.stringify({
          success: false,
          error: `Push verification failed: origin/${targetBranch} does not exist after push`,
        });
      }

      // Open PR via GitHub API
      let prUrl: string | null = null;
      let prExisting = false;
      try {
        [prUrl, , prExisting] = await createGithubPr(
          repoOwner,
          repoName,
          githubToken,
          title,
          targetBranch,
          body,
        );
      } catch (error: any) {
        logger.error(
          {
            threadId,
            repo: `${repoOwner}/${repoName}`,
            head: targetBranch,
            tokenSource,
            error: error?.message || String(error),
          },
          "[commit_and_open_pr] GitHub PR creation failed",
        );
        throw new Error(
          `GitHub PR creation failed for ${repoOwner}/${repoName}:${targetBranch}. ${error?.message || "Unknown PR error"}`,
        );
      }

      if (!prUrl) {
        logger.error(
          {
            threadId,
            repo: `${repoOwner}/${repoName}`,
            head: targetBranch,
            tokenSource,
          },
          "[commit_and_open_pr] PR URL missing after createGithubPr",
        );
        return JSON.stringify({ success: false, error: "Failed to create PR" });
      }

      return JSON.stringify({
        success: true,
        pr_url: prUrl,
        pr_existing: prExisting,
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "commit_and_open_pr",
    description: "Commit all current changes and open a GitHub Pull Request.",
    schema: z.object({
      title: z.string().describe("PR title following standard format"),
      body: z.string().describe("PR description"),
      commit_message: z
        .string()
        .optional()
        .describe("Optional git commit message"),
    }),
  },
);
