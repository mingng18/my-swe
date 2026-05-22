/**
 * Local git operations within a sandbox.
 */

import { SandboxService } from "../../integrations/sandbox-service";
import { shellEscapeSingleQuotes } from "../shell";

export interface ExecuteResponse {
  exitCode: number;
  output: string;
  error?: string;
}

export interface RepoConfig {
  owner: string;
  name: string;
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

  const credPath = `/tmp/git-creds-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  try {
    // Use credential store file instead of embedding token in remote URL
    await backend.execute(
      `echo "https://x-access-token:${githubToken}@github.com" > ${credPath} && chmod 600 ${credPath}`,
    );

    // Push using the credential helper
    const result = await runGit(
      backend,
      repoDir,
      `git -c credential.helper="store --file=${credPath}" push origin ${shellEscapeSingleQuotes(branch)}`,
    );

    return result;
  } catch (err: any) {
    const rawMsg: string = err?.message ?? String(err);
    const safeMsg = sanitizeTokenFromString(rawMsg, githubToken);
    throw new Error(safeMsg);
  } finally {
    // Clean up the credential file
    try {
      await backend.execute(`rm -f ${credPath}`);
    } catch (cleanupError) {
      logger.error(
        "[github] Failed to clean up git credentials file",
        cleanupError,
      );
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
