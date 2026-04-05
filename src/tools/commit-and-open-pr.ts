import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  createGithubPr,
  gitAddAll,
  gitCommit,
  gitPush,
  gitConfigUser,
  gitHasUncommittedChanges,
  gitFetchOrigin,
  gitHasUnpushedCommits,
} from "../utils/github/index";
import { getSandboxBackendSync } from "../utils/sandboxState";
import { getGithubTokenFromThread } from "../utils/github/github-token";
import { createLogger } from "../utils/logger";

const logger = createLogger("commit-and-open-pr-tool");

function shellEscapeSingleQuotes(input: string): string {
  return `'${input.replace(/'/g, `'"'"'`)}'}`;
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

      logger.info(
        { threadId, workspaceDir },
        "[commit_and_open_pr] Step 1/9: Configuring git user...",
      );
      await gitConfigUser(
        sandbox,
        workspaceDir,
        "open-swe[bot]",
        "open-swe@users.noreply.github.com",
      );
      logger.info(
        { threadId },
        "[commit_and_open_pr] Step 1/9: Git user configured ✓",
      );

      // Prefer an explicit branch name from metadata; otherwise follow the
      // open-swe/<thread_id> convention from the Python implementation.
      const metadataBranchName = (config as any)?.metadata?.branch_name as
        | string
        | undefined;
      // Match Python semantics: use simple branch name without timestamp
      const targetBranch =
        metadataBranchName && metadataBranchName.trim().length > 0
          ? metadataBranchName.trim()
          : `open-swe/${threadId}`;

      logger.info(
        { threadId, targetBranch, metadataBranchName },
        "[commit_and_open_pr] Step 2/9: Checking if branch exists locally...",
      );
      // Match Python semantics: check if branch exists locally before deciding.
      // If branch exists, checkout without reset. If not, create new branch.
      const branchCheckResult = await sandbox.execute(
        `cd ${shellEscapeSingleQuotes(workspaceDir)} && git branch --list ${shellEscapeSingleQuotes(targetBranch)}`,
      );
      const branchExists = branchCheckResult.output.trim().length > 0;
      logger.info(
        { threadId, targetBranch, branchExists },
        "[commit_and_open_pr] Step 2/9: Branch check complete ✓",
      );

      logger.info(
        { threadId, targetBranch, branchExists },
        "[commit_and_open_pr] Step 3/9: Checking out branch...",
      );
      if (branchExists) {
        // Branch exists: checkout without resetting (-B would discard commits)
        logger.info(
          { threadId, targetBranch },
          "[commit_and_open_pr] Step 3/9: Checking out existing branch...",
        );
        await sandbox.execute(
          `cd ${shellEscapeSingleQuotes(workspaceDir)} && git checkout ${shellEscapeSingleQuotes(targetBranch)}`,
        );
      } else {
        // Branch doesn't exist: create it
        logger.info(
          { threadId, targetBranch },
          "[commit_and_open_pr] Step 3/9: Creating new branch...",
        );
        await sandbox.execute(
          `cd ${shellEscapeSingleQuotes(workspaceDir)} && git checkout -b ${shellEscapeSingleQuotes(targetBranch)}`,
        );
      }
      logger.info(
        { threadId, targetBranch },
        "[commit_and_open_pr] Step 3/9: Branch checkout complete ✓",
      );

      // Detect both uncommitted changes and unpushed commits, matching the Python
      // behavior that proceeds when either exists.
      logger.info(
        { threadId },
        "[commit_and_open_pr] Step 4/9: Fetching origin to check for unpushed commits...",
      );
      await gitFetchOrigin(sandbox, workspaceDir);
      logger.info(
        { threadId },
        "[commit_and_open_pr] Step 4/9: Git fetch complete ✓",
      );

      logger.info(
        { threadId },
        "[commit_and_open_pr] Step 5/9: Checking for uncommitted changes...",
      );
      const hasUncommittedChanges = await gitHasUncommittedChanges(
        sandbox,
        workspaceDir,
      );
      logger.info(
        { threadId, hasUncommittedChanges },
        "[commit_and_open_pr] Step 5/9: Uncommitted changes check complete ✓",
      );

      logger.info(
        { threadId },
        "[commit_and_open_pr] Step 6/9: Checking for unpushed commits...",
      );
      const hasUnpushedCommits = await gitHasUnpushedCommits(
        sandbox,
        workspaceDir,
      );
      logger.info(
        { threadId, hasUnpushedCommits },
        "[commit_and_open_pr] Step 6/9: Unpushed commits check complete ✓",
      );

      if (!hasUncommittedChanges && !hasUnpushedCommits) {
        logger.info(
          { threadId },
          "[commit_and_open_pr] No changes detected, aborting",
        );
        return JSON.stringify({
          success: false,
          error: "No changes detected",
        });
      }

      logger.info(
        { threadId, hasUncommittedChanges, hasUnpushedCommits },
        "[commit_and_open_pr] Step 7/9: Staging and committing changes...",
      );
      // Only create a new commit when there are uncommitted changes; still allow
      // push + PR creation when there are only unpushed commits.
      if (hasUncommittedChanges) {
        logger.info(
          { threadId },
          "[commit_and_open_pr] Step 7/9: Running git add --all...",
        );
        await gitAddAll(sandbox, workspaceDir);
        logger.info(
          { threadId, commitMessage: commit_message || title },
          "[commit_and_open_pr] Step 7/9: Running git commit...",
        );
        await gitCommit(sandbox, workspaceDir, commit_message || title);
      }
      logger.info(
        { threadId },
        "[commit_and_open_pr] Step 7/9: Commit complete ✓",
      );

      // Note: We do NOT force checkout here. If the branch already exists and has
      // commits from a previous run, we want to preserve them. This matches the
      // Python implementation's behavior of reusing existing branches.

      logger.info(
        { threadId, targetBranch },
        "[commit_and_open_pr] Step 8/9: Pushing to GitHub...",
      );
      try {
        await gitPush(sandbox, workspaceDir, targetBranch, githubToken);
        logger.info(
          { threadId, targetBranch },
          "[commit_and_open_pr] Step 8/9: Push complete ✓",
        );
      } catch (pushError: any) {
        const pushErrorMsg = pushError?.message || String(pushError);
        // If push fails due to non-fast-forward, try force push with the same token-URL auth.
        if (
          pushErrorMsg.includes("non-fast-forward") ||
          pushErrorMsg.includes("rejected")
        ) {
          logger.warn(
            {
              threadId,
              repo: `${repoOwner}/${repoName}`,
              branch: targetBranch,
            },
            "[commit_and_open_pr] Push rejected (diverged branch), force-pushing...",
          );
          try {
            await gitPush(
              sandbox,
              workspaceDir,
              `+${targetBranch}`,
              githubToken,
            );
          } catch (forceError: any) {
            const forceErrorMsg = forceError?.message || String(forceError);
            logger.error(
              {
                threadId,
                repo: `${repoOwner}/${repoName}`,
                branch: targetBranch,
                tokenSource,
                error: forceErrorMsg,
              },
              "[commit_and_open_pr] Force push also failed",
            );
            return JSON.stringify({
              success: false,
              error: `Force push failed for ${repoOwner}/${repoName}:${targetBranch}. ${forceErrorMsg}`,
            });
          }
        } else {
          logger.error(
            {
              threadId,
              repo: `${repoOwner}/${repoName}`,
              branch: targetBranch,
              tokenSource,
              error: pushErrorMsg,
            },
            "[commit_and_open_pr] git push failed",
          );
          return JSON.stringify({
            success: false,
            error: `Push failed for ${repoOwner}/${repoName}:${targetBranch}. ${pushErrorMsg}`,
          });
        }
      }

      // Note: We don't verify remote branch existence via local git (e.g., git rev-parse origin/branch)
      // because shallow/single-branch clones (like Daytona's) have restricted refspecs that prevent
      // local tracking of remote branches. Instead, we rely on:
      // 1. gitPush throwing an error if the push actually fails
      // 2. createGithubPr failing via GitHub API if the branch doesn't exist remotely

      // Open PR via GitHub API
      logger.info(
        { threadId, repo: `${repoOwner}/${repoName}`, title },
        "[commit_and_open_pr] Step 9/9: Creating GitHub PR via API...",
      );
      let prUrl: string | null = null;
      let prExisting = false;
      try {
        logger.info(
          { threadId, title, targetBranch },
          "[commit_and_open_pr] Step 9/9: Calling createGithubPr...",
        );
        [prUrl, , prExisting] = await createGithubPr(
          repoOwner,
          repoName,
          githubToken,
          title,
          targetBranch,
          body,
        );
        logger.info(
          { threadId, prUrl, prExisting },
          "[commit_and_open_pr] Step 9/9: PR created successfully ✓",
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
