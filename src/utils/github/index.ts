/**
 * GitHub utilities - Entry point
 *
 * Exports all GitHub-related utilities for easy importing.
 */

// GitHub API operations
export {
	closeGithubIssue,
	createGithubIssue,
	createGithubPr,
	findExistingPr,
	getGithubDefaultBranch,
	listGithubPrs,
	mergeGithubPr,
	reopenGithubIssue,
} from "./api";
// Authorship utilities
export {
	addPrCollaborationNote,
	addUserCoauthorTrailer,
	OPEN_SWE_BOT_EMAIL,
	OPEN_SWE_BOT_NAME,
	resolveTriggeringUserIdentity,
	type UserIdentity,
} from "./authorship";
// Git utilities
export {
	type ExecuteResponse,
	gitAddAll,
	gitCheckoutBranch,
	gitCleanFd,
	gitCleanRepository,
	gitCommit,
	gitConfigUser,
	gitCurrentBranch,
	gitFetchOrigin,
	gitGetRemoteUrl,
	gitHasUncommittedChanges,
	gitHasUnpushedCommits,
	gitPull,
	gitPush,
	gitRemoteBranchExists,
	gitResetHard,
	isValidGitRepo,
	type RepoConfig as GitRepoConfig,
	removeDirectory,
	runGit,
} from "./git";
// GitHub App token generation
export { getGithubAppInstallationToken } from "./github-app";
// GitHub API caching utilities
export {
	cachedGithubApiCall,
	githubApiCache,
	invalidatePrCache,
	invalidateRepoCache,
} from "./github-cache";
// GitHub webhook comment utilities
export {
	buildPrPrompt,
	extractPrContext,
	fetchIssueComments,
	fetchPrBranch,
	fetchPrCommentsSinceLastTag,
	formatGithubCommentBodyForPrompt,
	type GitHubComment,
	getThreadIdFromBranch,
	postGithubComment,
	type ReactToGithubCommentOptions,
	type RepoConfig,
	reactToGithubComment,
	sanitizeGithubCommentBody,
	verifyGithubSignature,
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
