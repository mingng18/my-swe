/**
 * GitHub API operations.
 */

import { Octokit } from "octokit";
import {
  cachedGithubApiCall,
  invalidatePrCache,
  invalidateRepoCache,
} from "./github-cache";

const logger = console;

// HTTP status codes
const HTTP_CREATED = 201;
const HTTP_UNPROCESSABLE_ENTITY = 422;

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

interface GitHubIssueResponse {
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
    // Invalidate PR cache for this repo
    invalidatePrCache(baseRepoOwner, baseRepoName);
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
        // Invalidate cache to get fresh PR list after 422
        invalidatePrCache(baseRepoOwner, baseRepoName);
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
      // Invalidate cache first — the pre-creation check may have cached an empty
      // result, but after a 422, GitHub's state may have changed.
      invalidatePrCache(baseRepoOwner, baseRepoName);
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

      const { data: pulls } = await cachedGithubApiCall(
        "GET",
        "pulls.list.all",
        { owner: baseRepoOwner, repo: baseRepoName, state, per_page: 100 },
        async () => {
          const results = await octokit.paginate(octokit.rest.pulls.list, {
            owner: baseRepoOwner,
            repo: baseRepoName,
            state,
            per_page: 100,
          });
          return { data: results };
        },
      );

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
    return pr as [string | null, number | null];
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

    const { data: repo } = await cachedGithubApiCall(
      "GET",
      "repos.get",
      { owner: repoOwner, repo: repoName },
      () =>
        octokit.rest.repos.get({
          owner: repoOwner,
          repo: repoName,
        }),
    );

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
    const { data: pulls } = await cachedGithubApiCall(
      "GET",
      "pulls.list.all",
      { owner: repoOwner, repo: repoName, state, per_page: 100 },
      async () => {
        const results = await octokit.paginate(octokit.rest.pulls.list, {
          owner: repoOwner,
          repo: repoName,
          state,
          per_page: 100,
        });
        return { data: results };
      },
    );
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
    // Invalidate PR cache for this repo after merge
    invalidatePrCache(repoOwner, repoName);
    return mergeResult;
  } catch (error: any) {
    logger.error(`[github] Failed to merge PR #${prNumber}:`, error);
    throw error;
  }
}

/**
 * Create a GitHub issue via the API.
 * @param repoOwner - Repository owner (e.g., "langchain-ai")
 * @param repoName - Repository name (e.g., "deepagents")
 * @param githubToken - GitHub access token
 * @param title - Issue title
 * @param body - Issue description
 * @returns Tuple of [issueUrl, issueNumber] - values are null if failed
 */
export async function createGithubIssue(
  repoOwner: string,
  repoName: string,
  githubToken: string,
  title: string,
  body: string,
): Promise<[string | null, number | null]> {
  const octokit = new Octokit({ auth: githubToken });

  logger.info(
    {
      repo: `${repoOwner}/${repoName}`,
      title,
    },
    "[github] Creating issue",
  );

  try {
    const { data: issue } = await octokit.rest.issues.create({
      owner: repoOwner,
      repo: repoName,
      title,
      body,
    });

    const issueUrl = issue.html_url ?? null;
    const issueNumber = issue.number ?? null;

    logger.info(
      {
        issueUrl,
        issueNumber,
        title: issue.title,
      },
      "[github] Issue created successfully",
    );

    // Invalidate repo cache for this repo after issue creation
    invalidateRepoCache(repoOwner, repoName);

    return [issueUrl, issueNumber];
  } catch (error: unknown) {
    const octokitError = error as {
      status?: number;
      message?: string;
      response?: unknown;
    };

    logger.error(
      {
        repo: `${repoOwner}/${repoName}`,
        title,
        status: octokitError.status,
        message: octokitError.message,
        response: (octokitError.response as any) ?? undefined,
      },
      "[github] GitHub API error while creating issue",
    );

    const statusMsg = octokitError.status
      ? `status=${octokitError.status}`
      : "status=unknown";
    throw new Error(
      `GitHub issue creation failed for ${repoOwner}/${repoName}. ${statusMsg}. ${octokitError.message ?? String(error)}`,
    );
  }
}

export async function closeGithubIssue(
  repoOwner: string,
  repoName: string,
  githubToken: string,
  issueNumber: number,
): Promise<{ url: string | null; number: number | null; state: string }> {
  const octokit = new Octokit({ auth: githubToken });

  logger.info(
    { repo: `${repoOwner}/${repoName}`, issueNumber },
    "[github] Closing issue",
  );

  const { data: issue } = await octokit.rest.issues.update({
    owner: repoOwner,
    repo: repoName,
    issue_number: issueNumber,
    state: "closed",
  });

  invalidateRepoCache(repoOwner, repoName);

  logger.info(
    { issueUrl: issue.html_url, issueNumber: issue.number, state: issue.state },
    "[github] Issue closed successfully",
  );

  return {
    url: issue.html_url ?? null,
    number: issue.number ?? null,
    state: issue.state,
  };
}
