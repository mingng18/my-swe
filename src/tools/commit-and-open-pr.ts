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
  gitCurrentBranch,
  runGit,
  getGithubAppInstallationToken,
  resolveTriggeringUserIdentity,
  addUserCoauthorTrailer,
  addPrCollaborationNote,
  OPEN_SWE_BOT_NAME,
  OPEN_SWE_BOT_EMAIL,
  type UserIdentity,
} from "../utils/github/index";
import { getSandboxBackendSync } from "../utils/sandboxState";
import { createLogger } from "../utils/logger";

const logger = createLogger("commit-and-open-pr-tool");

function shellEscapeSingleQuotes(input: string): string {
  return `'${input.replace(/'/g, `'"'"'`)}'`;
}

/**
Commit all current changes and open a GitHub Pull Request.

You MUST call this tool when you have completed your work and want to
submit your changes for review. This is the final step in your workflow.

IMPORTANT CITATION REQUIREMENT: After the PR is created, you MUST include
the PR URL as a clickable markdown link in your response to the user.
Format: [PR Title](https://github.com/owner/repo/pull/123)

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
    const threadId = config?.configurable?.thread_id as string | undefined;
    if (!threadId)
      return JSON.stringify({
        success: false,
        error: "Missing thread_id in config",
        pr_url: null,
      });

    const repoConfig = config.configurable?.repo as
      | { owner?: string; name?: string; workspaceDir?: string }
      | undefined;
    const repoOwner = repoConfig?.owner;
    const repoName = repoConfig?.name;
    const workspaceDir = repoConfig?.workspaceDir;

    if (!repoOwner || !repoName || !workspaceDir) {
      return JSON.stringify({
        success: false,
        error: "Missing repo owner/name in config",
        pr_url: null,
      });
    }

    // Sandbox instance
    const sandbox = getSandboxBackendSync(threadId);
    if (!sandbox) {
      return JSON.stringify({
        success: false,
        error: "No sandbox found for thread",
        pr_url: null,
      });
    }

    try {
      // Resolve GitHub token using GitHub App (following Python implementation)
      const installationToken = await getGithubAppInstallationToken();
      if (!installationToken) {
        return JSON.stringify({
          success: false,
          error: "Failed to get GitHub App installation token",
          pr_url: null,
        });
      }

      // Resolve triggering user identity for co-authorship
      const userIdentity: UserIdentity = resolveTriggeringUserIdentity(
        config as Record<string, unknown>,
        installationToken,
      );

      // Add collaboration note to PR body
      const prBody = addPrCollaborationNote(body, userIdentity);

      logger.info("[commit_and_open_pr] Checking for uncommitted changes...");
      const hasUncommittedChanges = await gitHasUncommittedChanges(
        sandbox,
        workspaceDir,
      );

      logger.info(
        "[commit_and_open_pr] Fetching origin to check for unpushed commits...",
      );
      await gitFetchOrigin(sandbox, workspaceDir);

      logger.info("[commit_and_open_pr] Checking for unpushed commits...");
      const hasUnpushedCommits = await gitHasUnpushedCommits(
        sandbox,
        workspaceDir,
      );

      if (!hasUncommittedChanges && !hasUnpushedCommits) {
        return JSON.stringify({
          success: false,
          error: "No changes detected",
          pr_url: null,
        });
      }

      // Determine branch name (following Python implementation)
      const metadata = (config.metadata ?? {}) as Record<string, unknown>;
      const branchName = metadata.branch_name as string | undefined;
      const currentBranch = await gitCurrentBranch(sandbox, workspaceDir);
      const targetBranch = branchName ?? `open-swe/${threadId}`;

      if (currentBranch !== targetBranch) {
        logger.info(
          `[commit_and_open_pr] Checking out branch: ${targetBranch}`,
        );
        if (branchName) {
          // Existing branch — plain checkout, do not create or reset
          try {
            await runGit(
              sandbox,
              workspaceDir,
              `git checkout ${shellEscapeSingleQuotes(targetBranch)}`,
            );
          } catch (err) {
            return JSON.stringify({
              success: false,
              error: `Failed to checkout branch ${targetBranch}`,
              pr_url: null,
            });
          }
        } else {
          // Create new branch
          const checkoutSuccess = await runGit(
            sandbox,
            workspaceDir,
            `git checkout -b ${shellEscapeSingleQuotes(targetBranch)}`,
          );
          if (!checkoutSuccess) {
            return JSON.stringify({
              success: false,
              error: `Failed to checkout branch ${targetBranch}`,
              pr_url: null,
            });
          }
        }
      }

      // Configure git user
      await gitConfigUser(
        sandbox,
        workspaceDir,
        OPEN_SWE_BOT_NAME,
        OPEN_SWE_BOT_EMAIL,
      );

      // Stage all changes
      await gitAddAll(sandbox, workspaceDir);

      // Create commit with co-author trailer (following Python implementation)
      const commitMsg = addUserCoauthorTrailer(
        commit_message || title,
        userIdentity,
      );
      if (hasUncommittedChanges) {
        await gitCommit(sandbox, workspaceDir, commitMsg);
      }

      // Push to GitHub
      await gitPush(sandbox, workspaceDir, targetBranch, installationToken);

      // Create PR (createGithubPr internally fetches the default branch)
      const [prUrl, , prExisting] = await createGithubPr(
        repoOwner,
        repoName,
        installationToken,
        title,
        targetBranch,
        prBody,
      );

      if (!prUrl) {
        return JSON.stringify({
          success: false,
          error: "Failed to create GitHub PR",
          pr_url: null,
          pr_existing: false,
        });
      }

      const response = {
        success: true,
        error: null,
        pr_url: prUrl,
        pr_existing: prExisting,
      };

      // Format response with citation reminder
      const jsonString = JSON.stringify(response);
      const citationReminder = `\n\nIMPORTANT: When responding to the user, you MUST include the PR URL as a clickable link: [${prUrl}](${prUrl})`;

      return jsonString + citationReminder;
    } catch (error: any) {
      logger.error("[commit_and_open_pr] Error:", error);
      return JSON.stringify({
        success: false,
        error: `${error?.constructor?.name || "Error"}: ${error?.message || String(error)}`,
        pr_url: null,
      });
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
