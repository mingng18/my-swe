/**
 * GitHub API and git utilities.
 *
 * Provides functions for git operations within a sandbox
 * and GitHub API operations like creating PRs.
 */

import { Octokit } from "octokit";
import type { Sandbox } from "@daytonaio/sdk";
import { SandboxService } from "../../integrations/sandbox-service";

const logger = console;

// HTTP status codes
const HTTP_CREATED = 201;
const HTTP_UNPROCESSABLE_ENTITY = 422;

/**
 * Safely embed an arbitrary string into a POSIX shell command.
 * Produces: 'foo'"'"'bar' style quoting.
 */
function shellEscapeSingleQuotes(input: string): string {
  return `'${input.replace(/'/g, `'"'"'`)}'`;
}

export interface ExecuteResponse {
  exitCode: number;
  output: string;
  error?: string;
}

export interface RepoConfig {
  owner: string;
  name: string;
}

interface GitHubPRResponse {
  html_url?: string;
  number?: number;
  message?: string;
  errors?: Array<{
    resource?: string;
    field?: string;
    code?: string;
    message?: string;
  }>;
}

interface GitHubRepoResponse {
  default_branch?: string;
}

/**
 * Run a git command in the sandbox repo directory.
 * @param backend - The sandbox backend
 * @param repoDir - Repository directory path
 * @param command - Git command to run
 * @returns Execute response with exit code and output
 */
export function runGit(
  backend: SandboxService,
  repoDir: string,
  command: string,
): Promise<string> {
  return backend
    .execute(`cd ${shellEscapeSingleQuotes(repoDir)} && ${command}`)
    .then((r) => {
      const exitCode = r.exitCode ?? 0;
      if (exitCode !== 0) {
        const details = (r.output || "unknown error").trim();
        throw new Error(`Git command failed: ${command}\n${details}`);
      }
      return r.output;
    });
}

/**
 * Check if directory is a valid git repository.
 * @param backend - The sandbox backend
 * @param repoDir - Repository directory path
 * @returns True if valid git repo
 */
export async function isValidGitRepo(
  backend: SandboxService,
  repoDir: string,
): Promise<boolean> {
  const gitDir = `${repoDir}/.git`;
  const result = await backend.execute(
    `test -d ${shellEscapeSingleQuotes(gitDir)} && echo exists`,
  );
  return result.output.trim() === "exists";
}

/**
 * Remove a directory and all its contents.
 * @param backend - The sandbox backend
 * @param repoDir - Directory path to remove
 * @returns True if successful
 */
export async function removeDirectory(
  backend: SandboxService,
  repoDir: string,
): Promise<boolean> {
  const result = await backend.execute(
    `rm -rf ${shellEscapeSingleQuotes(repoDir)}`,
  );
  // Success if no error output
  return result.output === "";
}

/**
 * Check whether the repo has uncommitted changes.
 * @param backend - The sandbox backend
 * @param repoDir - Repository directory path
 * @returns True if there are uncommitted changes
 */
export async function gitHasUncommittedChanges(
  backend: SandboxService,
  repoDir: string,
): Promise<boolean> {
  logger.debug(`[gitHasUncommittedChanges] Checking status in ${repoDir}`);
  const result = await runGit(backend, repoDir, "git status --porcelain");
  const hasChanges = result.trim().length > 0;
  logger.debug(`[gitHasUncommittedChanges] Has uncommitted: ${hasChanges}`);
  return hasChanges;
}

/**
 * Fetch latest from origin (best-effort).
 * @param backend - The sandbox backend
 * @param repoDir - Repository directory path
 * @returns Execute response
 */
export async function gitFetchOrigin(
  backend: SandboxService,
  repoDir: string,
): Promise<string> {
  logger.debug(`[gitFetchOrigin] Fetching origin in ${repoDir}`);
  const result = await runGit(
    backend,
    repoDir,
    "git fetch origin 2>/dev/null || true",
  );
  logger.debug(`[gitFetchOrigin] Fetch complete`);
  return result;
}

/**
 * Pull latest changes from the current branch's upstream.
 * @param backend - The sandbox backend
 * @param repoDir - Repository directory path
 * @returns Execute response
 */
export async function gitPull(
  backend: SandboxService,
  repoDir: string,
): Promise<string> {
  return await runGit(backend, repoDir, "git pull 2>/dev/null || true");
}

/**
 * Check whether there are commits not pushed to upstream.
 * @param backend - The sandbox backend
 * @param repoDir - Repository directory path
 * @returns True if there are unpushed commits
 */
export async function gitHasUnpushedCommits(
  backend: SandboxService,
  repoDir: string,
): Promise<boolean> {
  logger.debug(
    `[gitHasUnpushedCommits] Checking for unpushed commits in ${repoDir}`,
  );
  const gitLogCmd =
    "git log --oneline @{upstream}..HEAD 2>/dev/null " +
    "|| git log --oneline origin/HEAD..HEAD 2>/dev/null || echo ''";
  logger.debug(`[gitHasUnpushedCommits] Running: ${gitLogCmd}`);
  const result = await runGit(backend, repoDir, gitLogCmd);
  const hasUnpushed = result.trim().length > 0;
  logger.debug(`[gitHasUnpushedCommits] Has unpushed: ${hasUnpushed}`);
  return hasUnpushed;
}

/**
 * Get the current git branch name.
 * @param backend - The sandbox backend
 * @param repoDir - Repository directory path
 * @returns Current branch name, or empty string if error
 */
export async function gitCurrentBranch(
  backend: SandboxService,
  repoDir: string,
): Promise<string> {
  const result = await runGit(
    backend,
    repoDir,
    "git rev-parse --abbrev-ref HEAD",
  );
  return result.trim();
}

/**
 * Checkout branch, creating it if needed.
 * @param backend - The sandbox backend
 * @param repoDir - Repository directory path
 * @param branch - Branch name to checkout
 * @returns True if successful
 */
export async function gitCheckoutBranch(
  backend: SandboxService,
  repoDir: string,
  branch: string,
): Promise<boolean> {
  await runGit(
    backend,
    repoDir,
    `git checkout -B ${shellEscapeSingleQuotes(branch)}`,
  );
  return true;
}

/**
 * Configure git user name and email.
 * @param backend - The sandbox backend
 * @param repoDir - Repository directory path
 * @param name - User name
 * @param email - User email
 */
export async function gitConfigUser(
  backend: SandboxService,
  repoDir: string,
  name: string,
  email: string,
): Promise<void> {
  logger.debug(`[gitConfigUser] Setting user.name: ${name} in ${repoDir}`);
  await runGit(
    backend,
    repoDir,
    `git config user.name ${shellEscapeSingleQuotes(name)}`,
  );
  logger.debug(
    `[gitConfigUser] user.name set, now setting user.email: ${email}`,
  );
  await runGit(
    backend,
    repoDir,
    `git config user.email ${shellEscapeSingleQuotes(email)}`,
  );
  logger.debug(`[gitConfigUser] Git user configured successfully`);
}

/**
 * Stage all changes.
 * @param backend - The sandbox backend
 * @param repoDir - Repository directory path
 * @returns Execute response
 */
export async function gitAddAll(
  backend: SandboxService,
  repoDir: string,
): Promise<string> {
  return await runGit(backend, repoDir, "git add -A");
}

/**
 * Commit staged changes with the given message.
 * @param backend - The sandbox backend
 * @param repoDir - Repository directory path
 * @param message - Commit message
 * @returns Execute response
 */
export async function gitCommit(
  backend: SandboxService,
  repoDir: string,
  message: string,
): Promise<string> {
  // Only commit if there are actually changes to commit.
  // This prevents "nothing to commit, working tree clean" errors.
  return await runGit(
    backend,
    repoDir,
    `git diff --quiet && git diff --staged --quiet || git commit -m ${shellEscapeSingleQuotes(message)}`,
  );
}

/**
 * Reset repository to clean state, discarding all uncommitted changes.
 * @param backend - The sandbox backend
 * @param repoDir - Repository directory path
 * @returns Execute response
 */
export async function gitResetHard(
  backend: SandboxService,
  repoDir: string,
): Promise<string> {
  return await runGit(backend, repoDir, "git reset --hard");
}

/**
 * Remove all untracked files and directories from the repository.
 * @param backend - The sandbox backend
 * @param repoDir - Repository directory path
 * @returns Execute response
 */
export async function gitCleanFd(
  backend: SandboxService,
  repoDir: string,
): Promise<string> {
  return await runGit(backend, repoDir, "git clean -fd");
}

/**
 * Clean the repository to a fresh state by resetting all changes and removing untracked files.
 * @param backend - The sandbox backend
 * @param repoDir - Repository directory path
 * @returns Execute response
 */
export async function gitCleanRepository(
  backend: SandboxService,
  repoDir: string,
): Promise<void> {
  await gitResetHard(backend, repoDir);
  await gitCleanFd(backend, repoDir);
}

/**
 * Get the origin remote URL.
 * @param backend - The sandbox backend
 * @param repoDir - Repository directory path
 * @returns Remote URL, or null if not found
 */
export async function gitGetRemoteUrl(
  backend: SandboxService,
  repoDir: string,
): Promise<string | null> {
  const result = await runGit(backend, repoDir, "git remote get-url origin");
  const trimmed = result.trim();
  return trimmed || null;
}

/**
 * Replace all occurrences of a token in a string with '***'.
 * Prevents accidental token leakage in error messages and logs.
 */
export function sanitizeTokenFromString(msg: string, token: string): string {
  if (!token) return msg;
  return msg.split(token).join("***");
}

/**
 * Sanitize an authenticated GitHub URL by hiding the token.
 * Prevents token leakage in logs and error messages.
 */
export function sanitizeAuthUrl(url: string): string {
  // Replace x-access-token:TOKEN@ with ***
  return url.replace(/\/\/x-access-token:[^@]+@/, "//***@");
}

/**
 * Push branch to origin using URL-embedded token authentication.
 * Uses `https://x-access-token:<TOKEN>@github.com/...` so no credential
 * helper or credential file is needed — works reliably in headless sandboxes.
 * @param backend - The sandbox backend
 * @param repoDir - Repository directory path
 * @param branch - Branch name to push
 * @param githubToken - Optional GitHub access token
 * @returns Execute response
 */
export async function gitPush(
  backend: SandboxService,
  repoDir: string,
  branch: string,
  githubToken?: string,
): Promise<string> {
  if (!githubToken) {
    return await runGit(
      backend,
      repoDir,
      `git push origin ${shellEscapeSingleQuotes(branch)}`,
    );
  }

  // Get current remote URL
  const remoteUrl = await gitGetRemoteUrl(backend, repoDir);
  if (!remoteUrl) {
    throw new Error("Could not get git remote URL");
  }

  // Construct authenticated URL by embedding token
  const authUrl = remoteUrl.replace(
    "https://github.com/",
    `https://x-access-token:${githubToken}@github.com/`,
  );

  // Log sanitized URL (without token) for debugging
  logger.debug(
    { sanitizedAuthUrl: sanitizeAuthUrl(authUrl) },
    "[github] Using authenticated git remote",
  );

  try {
    // Temporarily set remote to authenticated URL
    await backend.execute(
      `cd ${shellEscapeSingleQuotes(repoDir)} && git remote set-url origin ${authUrl}`,
    );

    // Push using the authenticated remote
    const result = await runGit(
      backend,
      repoDir,
      `git push origin ${shellEscapeSingleQuotes(branch)}`,
    );

    return result;
  } catch (err: any) {
    const rawMsg: string = err?.message ?? String(err);
    const safeMsg = sanitizeTokenFromString(rawMsg, githubToken);
    throw new Error(safeMsg);
  } finally {
    // Restore original remote URL
    if (remoteUrl) {
      try {
        await backend.execute(
          `cd ${shellEscapeSingleQuotes(repoDir)} && git remote set-url origin ${remoteUrl}`,
        );
      } catch (restoreError) {
        logger.error(
          "[github] Failed to restore original remote URL",
          restoreError,
        );
      }
    }
  }
}

/**
 * Check whether a branch exists on origin.
 * @param backend - The sandbox backend
 * @param repoDir - Repository directory path
 * @param branch - Branch name to check
 * @returns True if branch exists on origin
 */
export async function gitRemoteBranchExists(
  backend: SandboxService,
  repoDir: string,
  branch: string,
): Promise<boolean> {
  const result = await backend.execute(
    `cd ${shellEscapeSingleQuotes(repoDir)} && git ls-remote --exit-code --heads origin ${shellEscapeSingleQuotes(branch)}`,
  );
  return (result.exitCode ?? 1) === 0;
}

/**
 * Create a draft GitHub pull request via the API.
 * @param repoOwner - Repository owner (e.g., "langchain-ai")
 * @param repoName - Repository name (e.g., "deepagents")
 * @param githubToken - GitHub access token
 * @param title - PR title
 * @param headBranch - Source branch name
 * @param baseBranch - Target branch name
 * @param body - PR description
 * @returns Tuple of [prUrl, prNumber, prExisting] - values are null if failed
 */
export async function createGithubPr(
  headRepoOwner: string,
  headRepoName: string,
  githubToken: string,
  title: string,
  headBranch: string,
  body: string,
): Promise<[string | null, number | null, boolean]> {
  const octokit = new Octokit({ auth: githubToken });

  // Fork-aware logic: if the head repo is a fork, open the PR against the
  // parent/upstream repository instead of the fork.
  const {
    data: headRepoData,
  }: {
    data: { parent?: { owner: { login: string }; name: string } };
  } = await octokit.rest.repos.get({
    owner: headRepoOwner,
    repo: headRepoName,
  });

  const baseRepoOwner = headRepoData.parent?.owner.login ?? headRepoOwner;
  const baseRepoName = headRepoData.parent?.name ?? headRepoName;
  const baseBranch = await getGithubDefaultBranch(
    baseRepoOwner,
    baseRepoName,
    githubToken,
  );

  // Check for existing PR BEFORE attempting creation (prevents 422 errors)
  const existingPr = await findExistingPr(
    baseRepoOwner,
    baseRepoName,
    headRepoOwner,
    githubToken,
    headBranch,
  );
  if (existingPr) {
    logger.info(
      { prUrl: existingPr[0], prNumber: existingPr[1], headBranch },
      "[github] Existing PR found, returning without creating new one",
    );
    return [existingPr[0], existingPr[1], true];
  }

  const tryCreate = async (
    headRef: string,
  ): Promise<[string | null, number | null, boolean]> => {
    logger.info(
      {
        headRepo: `${headRepoOwner}/${headRepoName}`,
        headRef,
        headBranch,
        baseRepo: `${baseRepoOwner}/${baseRepoName}`,
        baseBranch,
        title,
      },
      "[github] Creating PR",
    );
    const { data: pr } = await octokit.rest.pulls.create({
      owner: baseRepoOwner,
      repo: baseRepoName,
      title,
      head: headRef,
      base: baseBranch,
      body,
      draft: true,
    });
    const prUrl = pr.html_url ?? null;
    const prNumber = pr.number ?? null;
    logger.info(
      {
        prUrl,
        prNumber,
        base: pr.base?.ref,
        head: pr.head?.ref,
        headLabel: pr.head?.label,
        headRepo: pr.head?.repo?.full_name,
      },
      "[github] PR created successfully",
    );
    return [prUrl, prNumber, false];
  };

  // For forks, GitHub expects `headOwner:branch`.
  const crossRepoHeadRef = `${headRepoOwner}:${headBranch}`;

  try {
    return await tryCreate(crossRepoHeadRef);
  } catch (error: unknown) {
    const octokitError = error as {
      status?: number;
      message?: string;
      response?: unknown;
    };

    if (octokitError.status === HTTP_UNPROCESSABLE_ENTITY) {
      logger.error(
        {
          headRepo: `${headRepoOwner}/${headRepoName}`,
          baseRepo: `${baseRepoOwner}/${baseRepoName}`,
          headRef: crossRepoHeadRef,
          headBranch,
          baseBranch,
          status: octokitError.status,
          message: octokitError.message,
          // Log response payload for debugging.
          response: (octokitError.response as any) ?? undefined,
        },
        "[github] GitHub API validation error (422) while creating PR",
      );

      // Check if the error is about an existing PR
      const responseStr = JSON.stringify((octokitError.response as any) ?? {});
      const errorMsg = String(octokitError.message || "");
      const isExistingPrError =
        errorMsg.toLowerCase().includes("already exists") ||
        errorMsg.toLowerCase().includes("a pull request already exists") ||
        responseStr.toLowerCase().includes("already exists");

      if (isExistingPrError) {
        logger.info(
          {
            headRef: crossRepoHeadRef,
            baseRepo: `${baseRepoOwner}/${baseRepoName}`,
          },
          "[github] 422 error indicates existing PR, searching for it...",
        );
        const existing = await findExistingPr(
          baseRepoOwner,
          baseRepoName,
          headRepoOwner,
          githubToken,
          headBranch,
        );
        if (existing) {
          logger.info(
            `[github] Found existing PR for head branch: ${existing[0]}`,
          );
          return [existing[0], existing[1], true];
        }
        logger.warn(
          { headRef: crossRepoHeadRef },
          "[github] 422 error indicated existing PR but search found none, falling through",
        );
      }

      // For same-repo PRs, GitHub may reject owner-prefixed head refs. When
      // that happens, retry with the plain branch name.
      const likelyInvalidHead =
        String(octokitError.message || "").includes('"field":"head"') ||
        responseStr.includes('"field":"head"');

      if (likelyInvalidHead && !isExistingPrError) {
        try {
          logger.info(
            {
              note: "Retrying PR creation with plain head branch",
              plainHeadBranch: headBranch,
            },
            "[github] Retrying PR creation",
          );
          return await tryCreate(headBranch);
        } catch (retryError: unknown) {
          const retryOctokitError = retryError as {
            status?: number;
            message?: string;
            response?: unknown;
          };
          logger.error(
            {
              status: retryOctokitError.status,
              message: retryOctokitError.message,
              response: (retryOctokitError.response as any) ?? undefined,
            },
            "[github] Retry failed while creating PR",
          );
        }
      }

      // Final attempt: search for existing PR as fallback
      const existing = await findExistingPr(
        baseRepoOwner,
        baseRepoName,
        headRepoOwner,
        githubToken,
        headBranch,
      );
      if (existing) {
        logger.info(`[github] Using existing PR as fallback: ${existing[0]}`);
        return [existing[0], existing[1], true];
      }
    } else {
      logger.error(
        {
          headRepo: `${headRepoOwner}/${headRepoName}`,
          baseRepo: `${baseRepoOwner}/${baseRepoName}`,
          headRef: crossRepoHeadRef,
          headBranch,
          baseBranch,
          status: octokitError.status,
          message: octokitError.message,
          response: (octokitError.response as any) ?? undefined,
        },
        "[github] GitHub API error while creating PR",
      );
    }

    const statusMsg = octokitError.status
      ? `status=${octokitError.status}`
      : "status=unknown";
    throw new Error(
      `GitHub PR creation failed for ${headRepoOwner}/${headRepoName} (${headBranch}) -> ${baseRepoOwner}/${baseRepoName}@${baseBranch}. ${statusMsg}. ${octokitError.message ?? String(error)}`,
    );
  }
}

/**
 * Find an existing PR for the given head branch.
 * @param baseRepoOwner - Base repository owner
 * @param baseRepoName - Base repository name
 * @param headRepoOwner - Head repository owner
 * @param githubToken - GitHub access token
 * @param headBranch - Head branch name
 * @returns Tuple of [prUrl, prNumber] or null if not found
 */
export async function findExistingPr(
  baseRepoOwner: string,
  baseRepoName: string,
  headRepoOwner: string,
  githubToken: string,
  headBranch: string,
): Promise<[string | null, number | null] | null> {
  const octokit = new Octokit({ auth: githubToken });

  logger.info(
    {
      baseRepo: `${baseRepoOwner}/${baseRepoName}`,
      headBranch,
    },
    "[github] Searching for existing PR",
  );

  const fetchState = async (state: "open" | "all") => {
    try {
      logger.debug(
        { state, baseRepo: `${baseRepoOwner}/${baseRepoName}` },
        "[github] Listing PRs",
      );

      const { data: pulls } = await octokit.rest.pulls.list({
        owner: baseRepoOwner,
        repo: baseRepoName,
        state,
        per_page: 50,
      });

      logger.debug(
        { state, pullCount: pulls.length },
        "[github] PR list response received",
      );

      // Filter in-memory instead of relying on the GitHub API `head` param
      const pr = pulls.find((p) => p.head.ref === headBranch);

      if (pr) {
        logger.info(
          {
            prNumber: pr.number,
            prUrl: pr.html_url,
            prState: pr.state,
            headLabel: pr.head?.label,
            headRef: pr.head?.ref,
          },
          "[github] Found existing PR",
        );
        return [pr.html_url ?? null, pr.number ?? null];
      }
    } catch (listError: unknown) {
      logger.error(
        {
          baseRepo: `${baseRepoOwner}/${baseRepoName}`,
          headBranch,
          state,
          error:
            (listError as any)?.message ??
            (listError as any)?.toString?.() ??
            String(listError),
        },
        "[github] Failed to list PRs",
      );
      // Continue to next state instead of throwing
    }
  };

  const [openPr, allPr] = await Promise.all([
    fetchState("open"),
    fetchState("all"),
  ]);

  const pr = openPr || allPr;
  if (pr) {
    return [pr.html_url ?? null, pr.number ?? null];
  }

  logger.info(
    { headBranch, baseRepo: `${baseRepoOwner}/${baseRepoName}` },
    "[github] No existing PR found",
  );
  return null;
}

/**
 * Get the default branch of a GitHub repository via the API.
 * @param repoOwner - Repository owner (e.g., "langchain-ai")
 * @param repoName - Repository name (e.g., "deepagents")
 * @param githubToken - GitHub access token
 * @returns The default branch name (e.g., "main" or "master")
 */
export async function getGithubDefaultBranch(
  repoOwner: string,
  repoName: string,
  githubToken: string,
): Promise<string> {
  try {
    const octokit = new Octokit({ auth: githubToken });

    const { data: repo } = await octokit.rest.repos.get({
      owner: repoOwner,
      repo: repoName,
    });

    const defaultBranch = repo.default_branch ?? "main";
    logger.debug(
      `[github] Got default branch from GitHub API: ${defaultBranch}`,
    );
    return defaultBranch;
  } catch (error) {
    logger.error(
      `[github] Failed to get default branch from GitHub API, falling back to 'main':`,
      error,
    );
    return "main";
  }
}

/**
 * List pull requests for a repository.
 * @param repoOwner - Repository owner
 * @param repoName - Repository name
 * @param githubToken - GitHub access token
 * @param state - PR state (open, closed, or all)
 * @returns Array of pull requests
 */
export async function listGithubPrs(
  repoOwner: string,
  repoName: string,
  githubToken: string,
  state: "open" | "closed" | "all" = "open",
): Promise<any[]> {
  try {
    const octokit = new Octokit({ auth: githubToken });
    const { data: pulls } = await octokit.rest.pulls.list({
      owner: repoOwner,
      repo: repoName,
      state,
      per_page: 50,
    });
    return pulls;
  } catch (error) {
    logger.error(`[github] Failed to list PRs:`, error);
    throw error;
  }
}

/**
 * Merge a pull request.
 * @param repoOwner - Repository owner
 * @param repoName - Repository name
 * @param githubToken - GitHub access token
 * @param prNumber - Pull request number
 * @returns Merge response data
 */
export async function mergeGithubPr(
  repoOwner: string,
  repoName: string,
  githubToken: string,
  prNumber: number,
): Promise<any> {
  try {
    const octokit = new Octokit({ auth: githubToken });
    const { data: mergeResult } = await octokit.rest.pulls.merge({
      owner: repoOwner,
      repo: repoName,
      pull_number: prNumber,
    });
    return mergeResult;
  } catch (error: any) {
    logger.error(`[github] Failed to merge PR #${prNumber}:`, error);
    throw error;
  }
}
