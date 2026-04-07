/**
 * GitHub utilities - Entry point
 *
 * Exports all GitHub-related utilities for easy importing.
 */

// GitHub App token generation
export { getGithubAppInstallationToken } from "./github-app";

// GitHub webhook comment utilities
export {
  verifyGithubSignature,
  getThreadIdFromBranch,
  sanitizeGithubCommentBody,
  formatGithubCommentBodyForPrompt,
  reactToGithubComment,
  postGithubComment,
  fetchIssueComments,
  fetchPrCommentsSinceLastTag,
  fetchPrBranch,
  extractPrContext,
  buildPrPrompt,
  type RepoConfig,
  type GitHubComment,
} from "./github-comments";

// GitHub token lookup utilities
export {
  getGithubToken,
  getGithubTokenFromThread,
  setGithubTokenInThread,
  storeGithubTokenInThread,
} from "./github-token";

// GitHub user to email mapping
export { GITHUB_USER_EMAIL_MAP } from "./github-user-email-map";

// Authorship utilities
export {
  resolveTriggeringUserIdentity,
  addUserCoauthorTrailer,
  addPrCollaborationNote,
  OPEN_SWE_BOT_NAME,
  OPEN_SWE_BOT_EMAIL,
  type UserIdentity,
} from "./authorship";

// Git utilities and GitHub API
export {
  isValidGitRepo,
  removeDirectory,
  gitHasUncommittedChanges,
  gitFetchOrigin,
  gitPull,
  gitHasUnpushedCommits,
  gitCurrentBranch,
  gitCheckoutBranch,
  gitConfigUser,
  gitAddAll,
  gitCommit,
  gitResetHard,
  gitCleanFd,
  gitCleanRepository,
  gitGetRemoteUrl,
  gitPush,
  gitRemoteBranchExists,
  createGithubPr,
  runGit,
  findExistingPr,
  listGithubPrs,
  mergeGithubPr,
  getGithubDefaultBranch,
  type ExecuteResponse,
  type RepoConfig as GitRepoConfig,
} from "./github";
