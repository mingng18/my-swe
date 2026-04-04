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
function runGit(
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
  const result = await runGit(backend, repoDir, "git status --porcelain");
  return result.trim().length > 0;
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
  return await runGit(backend, repoDir, "git fetch origin 2>/dev/null || true");
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
  const gitLogCmd =
    "git log --oneline @{upstream}..HEAD 2>/dev/null " +
    "|| git log --oneline origin/HEAD..HEAD 2>/dev/null || echo ''";
  const result = await runGit(backend, repoDir, gitLogCmd);
  return result.trim().length > 0;
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
  await runGit(
    backend,
    repoDir,
    `git config user.name ${shellEscapeSingleQuotes(name)}`,
  );
  await runGit(
    backend,
    repoDir,
    `git config user.email ${shellEscapeSingleQuotes(email)}`,
  );
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
  return await runGit(
    backend,
    repoDir,
    `git commit -m ${shellEscapeSingleQuotes(message)}`,
  );
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
 * Write GitHub credentials to a temporary file.
 * @param backend - The sandbox backend
 * @param githubToken - GitHub access token
 * @returns The path to the created credentials file
 */
export async function setupGitCredentials(
  backend: SandboxService,
  githubToken: string,
): Promise<string> {
  const mktempResult = await backend.execute('mktemp /tmp/git-credentials-XXXXXX');
  if (mktempResult.exitCode !== 0) {
    throw new Error(`Failed to create temporary git credentials file: ${mktempResult.output}`);
  }
  const credFilePath = mktempResult.output.trim();

  const content = `https://git:${githubToken}@github.com\n`;
  await backend.write(credFilePath, content);
  await backend.execute(`chmod 600 ${shellEscapeSingleQuotes(credFilePath)}`);

  return credFilePath;
}

/**
 * Remove the temporary credentials file.
 * @param backend - The sandbox backend
 * @param credFilePath - Path to the credentials file
 */
export async function cleanupGitCredentials(
  backend: SandboxService,
  credFilePath: string,
): Promise<void> {
  await backend.execute(`rm -f ${shellEscapeSingleQuotes(credFilePath)}`);
}

/**
 * Run a git command using the temporary credential file.
 * @param backend - The sandbox backend
 * @param repoDir - Repository directory path
 * @param command - Git command to run
 * @param credFilePath - Path to the credentials file
 * @returns Execute response
 */
async function gitWithCredentials(
  backend: SandboxService,
  repoDir: string,
  command: string,
  credFilePath: string,
): Promise<string> {
  return await runGit(
    backend,
    repoDir,
    `git -c credential.helper="store --file=${shellEscapeSingleQuotes(credFilePath)}" ${command}`,
  );
}

/**
 * Push the branch to origin, using a token if needed.
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

  const credFilePath = await setupGitCredentials(backend, githubToken);
  try {
    return await gitWithCredentials(
      backend,
      repoDir,
      `push origin ${shellEscapeSingleQuotes(branch)}`,
      credFilePath,
    );
  } finally {
    await cleanupGitCredentials(backend, credFilePath);
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

      // For same-repo PRs, GitHub may reject owner-prefixed head refs. When
      // that happens, retry with the plain branch name.
      const responseStr = JSON.stringify(
        (octokitError.response as any) ?? {},
      );
      const likelyInvalidHead =
        String(octokitError.message || "").includes('"field":"head"') ||
        responseStr.includes('"field":"head"');

      if (likelyInvalidHead) {
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

      // Try to find existing PR
      const existing = await findExistingPr(
        baseRepoOwner,
        baseRepoName,
        headRepoOwner,
        githubToken,
        headBranch,
      );
      if (existing) {
        logger.info(
          `[github] Using existing PR for head branch: ${existing[0]}`,
        );
        return [...existing, true];
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
 * @param repoOwner - Repository owner
 * @param repoName - Repository name
 * @param githubToken - GitHub access token
 * @param headBranch - Head branch name
 * @returns Tuple of [prUrl, prNumber] or [null, null] if not found
 */
async function findExistingPr(
  baseRepoOwner: string,
  baseRepoName: string,
  headRepoOwner: string,
  githubToken: string,
  headBranch: string,
): Promise<[string | null, number | null] | null> {
  const octokit = new Octokit({ auth: githubToken });
  const headRef = `${headRepoOwner}:${headBranch}`;

  for (const state of ["open", "all"] as const) {
    try {
      const { data: pulls } = await octokit.rest.pulls.list({
        owner: baseRepoOwner,
        repo: baseRepoName,
        head: headRef,
        state,
        per_page: 1,
      });

      if (pulls.length > 0) {
        const pr = pulls[0]!;
        return [pr.html_url ?? null, pr.number ?? null];
      }
    } catch (listError: unknown) {
      logger.error(
        {
          baseRepo: `${baseRepoOwner}/${baseRepoName}`,
          headRef,
          state,
          error:
            (listError as any)?.message ??
            (listError as any)?.toString?.() ??
            String(listError),
        },
        "[github] Failed to list existing PRs for head ref",
      );
      throw listError;
    }
  }

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
