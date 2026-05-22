/**
 * GitHub webhook comment utilities.
 *
 * Handles webhook signature verification, comment formatting,
 * reactions, and fetching comments from issues and PRs.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { Octokit } from "octokit";

import { IDENTITY_MAP } from "../identity";

const logger = console;

const OPEN_SWE_TAGS = ["@openswe", "@open-swe", "@openswe-dev"] as const;
const OPEN_SWE_REGEX = new RegExp(OPEN_SWE_TAGS.join("|"), "i");
export const UNTRUSTED_GITHUB_COMMENT_OPEN_TAG =
  "<dangerous-external-untrusted-users-comment>";
const UNTRUSTED_GITHUB_COMMENT_CLOSE_TAG =
  "</dangerous-external-untrusted-users-comment>";
const SANITIZED_UNTRUSTED_GITHUB_COMMENT_OPEN_TAG =
  "[blocked-untrusted-comment-tag-open]";
const SANITIZED_UNTRUSTED_GITHUB_COMMENT_CLOSE_TAG =
  "[blocked-untrusted-comment-tag-close]";

export interface RepoConfig {
  owner: string;
  name: string;
}

export interface GitHubComment {
  body: string;
  author: string;
  created_at: string;
  comment_id?: number;
  type?: "pr_comment" | "review_comment" | "review";
  path?: string;
  line?: number;
}

interface GitHubIssueComment {
  id: number;
  body: string | null;
  user: {
    login: string;
  };
  created_at: string;
}

interface GitHubPRComment {
  id: number;
  body: string | null;
  user: {
    login: string;
  };
  created_at: string;
  path?: string;
  line?: number;
  original_line?: number;
}

interface GitHubReview {
  id: number;
  body: string | null;
  user: {
    login: string;
  };
  submitted_at: string;
  node_id: string;
}

interface GraphQLReactionResponse {
  data?: {
    addReaction?: {
      reaction?: {
        content: string;
      };
    };
  };
  errors?: Array<{
    type?: string;
    message?: string;
  }>;
}

/**
 * Verify the GitHub webhook signature (X-Hub-Signature-256).
 * @param body - Raw request body bytes
 * @param signature - The X-Hub-Signature-256 header value
 * @param secret - The webhook signing secret
 * @returns True if signature is valid or no secret is configured
 */
export function verifyGithubSignature(
  body: Uint8Array | string,
  signature: string,
  secret: string,
): boolean {
  if (!secret) {
    logger.warn(
      "[github_comments] GITHUB_WEBHOOK_SECRET is not configured — rejecting webhook request",
    );
    return false;
  }

  const bodyStr =
    typeof body === "string" ? body : Buffer.from(body).toString("utf-8");
  const expected =
    "sha256=" + createHmac("sha256", secret).update(bodyStr).digest("hex");

  // Hash both strings to prevent timing attacks based on length
  const expectedHash = createHmac("sha256", secret).update(expected).digest();
  const signatureHash = createHmac("sha256", secret).update(signature).digest();

  return timingSafeEqual(expectedHash, signatureHash);
}

/**
 * Extract thread ID (UUID) from a branch name.
 * @param branchName - The branch name to search
 * @returns The UUID if found, null otherwise
 */
export function getThreadIdFromBranch(branchName: string): string | null {
  const uuidRegex =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const match = branchName.match(uuidRegex);
  return match ? match[0] : null;
}

/**
 * Strip reserved trust wrapper tags from raw GitHub comment bodies.
 * @param body - The comment body to sanitize
 * @returns Sanitized comment body
 */
export function sanitizeGithubCommentBody(body: string): string {
  let sanitized = body.replace(
    UNTRUSTED_GITHUB_COMMENT_OPEN_TAG,
    SANITIZED_UNTRUSTED_GITHUB_COMMENT_OPEN_TAG,
  );
  sanitized = sanitized.replace(
    UNTRUSTED_GITHUB_COMMENT_CLOSE_TAG,
    SANITIZED_UNTRUSTED_GITHUB_COMMENT_CLOSE_TAG,
  );

  if (sanitized !== body) {
    logger.warn(
      "[github_comments] Sanitized reserved untrusted-comment tags from GitHub comment body",
    );
  }

  return sanitized;
}

/**
 * Format a GitHub comment body for prompt inclusion.
 * Wraps untrusted user comments in special tags.
 * @param author - GitHub username of the comment author
 * @param body - The comment body
 * @returns Formatted comment body
 */
export function formatGithubCommentBodyForPrompt(
  author: string,
  body: string,
): string {
  const sanitizedBody = sanitizeGithubCommentBody(body);

  if (`github:${author}` in IDENTITY_MAP) {
    return sanitizedBody;
  }

  return `${UNTRUSTED_GITHUB_COMMENT_OPEN_TAG}\n${sanitizedBody}\n${UNTRUSTED_GITHUB_COMMENT_CLOSE_TAG}`;
}

/**
 * React to a GitHub comment with an "eyes" emoji.
 * @param repoConfig - Repository configuration
 * @param commentId - The comment ID
 * @param eventType - Type of comment event
 * @param token - GitHub access token
 * @param pullNumber - PR number (required for pull_request_review)
 * @param nodeId - GraphQL node ID (required for pull_request_review)
 * @returns True if successful
 */
export async function reactToGithubComment(
  repoConfig: RepoConfig,
  commentId: number,
  eventType: string,
  token: string,
  pullNumber?: number,
  nodeId?: string,
): Promise<boolean> {
  if (eventType === "pull_request_review") {
    return reactViaGraphql(nodeId, token);
  }

  const owner = repoConfig.owner ?? "";
  const repo = repoConfig.name ?? "";

  let url: string;
  if (eventType === "pull_request_review_comment") {
    url = `https://api.github.com/repos/${owner}/${repo}/pulls/comments/${commentId}/reactions`;
  } else {
    url = `https://api.github.com/repos/${owner}/${repo}/issues/comments/${commentId}/reactions`;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ content: "eyes" }),
    });

    // 200 = already reacted, 201 = just created
    return response.status === 200 || response.status === 201;
  } catch (error) {
    logger.error(
      `[github_comments] Failed to react to GitHub comment ${commentId}:`,
      error,
    );
    return false;
  }
}

/**
 * Add a 👀 reaction via GitHub GraphQL API (for PR review bodies).
 * @param nodeId - GraphQL node ID of the review
 * @param token - GitHub access token
 * @returns True if successful
 */
async function reactViaGraphql(
  nodeId?: string,
  token?: string,
): Promise<boolean> {
  if (!nodeId || !token) {
    logger.warn("[github_comments] No node_id provided for GraphQL reaction");
    return false;
  }

  const query = `
    mutation AddReaction($subjectId: ID!) {
      addReaction(input: {subjectId: $subjectId, content: EYES}) {
        reaction { content }
      }
    }
  `;

  try {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: { subjectId: nodeId },
      }),
    });

    const data = (await response.json()) as GraphQLReactionResponse;
    if (data.errors) {
      logger.warn("[github_comments] GraphQL reaction errors:", data.errors);
      return false;
    }
    return true;
  } catch (error) {
    logger.error(
      `[github_comments] Failed to react via GraphQL for node_id ${nodeId}:`,
      error,
    );
    return false;
  }
}

/**
 * Post a comment to a GitHub issue or PR.
 * @param repoConfig - Repository configuration
 * @param issueNumber - The issue or PR number
 * @param body - The comment body
 * @param token - GitHub access token
 * @returns True if successful
 */
export async function postGithubComment(
  repoConfig: RepoConfig,
  issueNumber: number,
  body: string,
  token: string,
): Promise<boolean> {
  const owner = repoConfig.owner ?? "";
  const repo = repoConfig.name ?? "";

  try {
    const octokit = new Octokit({ auth: token });
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });

    return true;
  } catch (error) {
    logger.error(
      `[github_comments] Failed to post comment to GitHub issue/PR #${issueNumber}:`,
      error,
    );
    return false;
  }
}

/**
 * Fetch all comments for a GitHub issue.
 * @param repoConfig - Repository configuration
 * @param issueNumber - The issue number
 * @param token - GitHub access token (optional)
 * @returns List of comments
 */
export async function fetchIssueComments(
  repoConfig: RepoConfig,
  issueNumber: number,
  token?: string,
): Promise<GitHubComment[]> {
  const owner = repoConfig.owner ?? "";
  const repo = repoConfig.name ?? "";

  try {
    const octokit = new Octokit({
      auth: token,
    });

    const comments: GitHubComment[] = [];
    for await (const response of octokit.paginate.iterator(
      octokit.rest.issues.listComments,
      {
        owner,
        repo,
        issue_number: issueNumber,
        headers: {
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    )) {
      comments.push(
        ...(response.data as GitHubIssueComment[]).map((comment) => ({
          body: comment.body ?? "",
          author: comment.user?.login ?? "unknown",
          created_at: comment.created_at,
          comment_id: comment.id,
        })),
      );
    }

    return comments;
  } catch (error) {
    logger.error(
      `[github_comments] Failed to fetch comments for issue #${issueNumber}:`,
      error,
    );
    return [];
  }
}

/**
 * Fetch all PR comments/reviews since the last @open-swe tag.
 * @param repoConfig - Repository configuration
 * @param prNumber - The pull request number
 * @param token - GitHub access token
 * @returns List of comments ordered chronologically from last @open-swe tag
 */
export async function fetchPrCommentsSinceLastTag(
  repoConfig: RepoConfig,
  prNumber: number,
  token: string,
): Promise<GitHubComment[]> {
  const owner = repoConfig.owner ?? "";
  const repo = repoConfig.name ?? "";

  try {
    const octokit = new Octokit({
      auth: token,
    });

    // Fetch all three types of comments in parallel
    const [prComments, reviewComments, reviews] = await Promise.all([
      fetchPaginatedComments<GitHubIssueComment>(
        octokit,
        octokit.rest.issues.listComments,
        { owner, repo, issue_number: prNumber },
      ),
      fetchPaginatedComments<GitHubPRComment>(
        octokit,
        octokit.rest.pulls.listReviewComments,
        { owner, repo, pull_number: prNumber },
      ),
      fetchPaginatedReviews(octokit, { owner, repo, pull_number: prNumber }),
    ]);

    const allComments: GitHubComment[] = [
      ...prComments.map((c) => ({
        body: c.body ?? "",
        author: c.user?.login ?? "unknown",
        created_at: c.created_at,
        type: "pr_comment" as const,
        comment_id: c.id,
      })),
      ...(reviewComments as GitHubPRComment[]).map((c) => ({
        body: c.body ?? "",
        author: c.user?.login ?? "unknown",
        created_at: c.created_at,
        type: "review_comment" as const,
        comment_id: c.id,
        path: c.path,
        line: c.line ?? c.original_line,
      })),
      ...reviews
        .filter((r) => r.body)
        .map((r) => ({
          body: r.body!,
          author: r.user?.login ?? "unknown",
          created_at: r.submitted_at!,
          type: "review" as const,
          comment_id: r.id,
        })),
    ];

    // Sort all comments chronologically
    allComments.sort((a, b) => a.created_at.localeCompare(b.created_at));

    // Find all @openswe / @open-swe mention positions
    // ⚡ Bolt: Using pre-compiled regex instead of lowercase/includes loop for faster tag matching
    const tagIndices = allComments.reduce((acc, comment, i) => {
      if (OPEN_SWE_REGEX.test(comment.body ?? "")) {
        acc.push(i);
      }
      return acc;
    }, [] as number[]);

    if (tagIndices.length === 0) {
      return [];
    }

    // If first @openswe invocation, return ALL comments
    // Otherwise, return everything since the previous tag
    const start =
      tagIndices.length === 1 ? 0 : tagIndices[tagIndices.length - 2] + 1;
    return allComments.slice(start);
  } catch (error) {
    logger.error(
      `[github_comments] Failed to fetch PR comments for #${prNumber}:`,
      error,
    );
    return [];
  }
}

/**
 * Helper to fetch paginated comments.
 */
async function fetchPaginatedComments<T>(
  octokit: Octokit,
  method: (...args: any[]) => any,
  params: Record<string, unknown>,
): Promise<T[]> {
  const results: T[] = [];
  for await (const response of octokit.paginate.iterator(method as any, {
    ...params,
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
    },
  })) {
    results.push(...(response.data as T[]));
  }
  return results;
}

/**
 * Helper to fetch paginated reviews.
 */
async function fetchPaginatedReviews(
  octokit: Octokit,
  params: Record<string, unknown>,
): Promise<GitHubReview[]> {
  const results: GitHubReview[] = [];
  for await (const response of octokit.paginate.iterator(
    octokit.rest.pulls.listReviews as any,
    {
      ...params,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  )) {
    results.push(...(response.data as GitHubReview[]));
  }
  return results;
}

/**
 * Fetch the head branch name of a PR from the GitHub API.
 * @param repoConfig - Repository configuration
 * @param prNumber - The pull request number
 * @param token - GitHub access token (optional)
 * @returns The head branch name, or empty string if not found
 */
export async function fetchPrBranch(
  repoConfig: RepoConfig,
  prNumber: number,
  token?: string,
): Promise<string> {
  const owner = repoConfig.owner ?? "";
  const repo = repoConfig.name ?? "";

  try {
    const octokit = new Octokit({
      auth: token,
    });

    const { data: pr } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    return pr.head?.ref ?? "";
  } catch (error) {
    logger.error(
      `[github_comments] Failed to fetch branch for PR #${prNumber}:`,
      error,
    );
    return "";
  }
}

/**
 * Extract key fields from a GitHub PR webhook payload.
 * @param payload - The webhook payload
 * @param eventType - The event type
 * @returns Tuple of extracted fields
 */
export async function extractPrContext(
  payload: Record<string, unknown>,
  eventType: string,
): Promise<
  [
    RepoConfig,
    number | null,
    string,
    string,
    string,
    number | null,
    string | null,
  ]
> {
  const repo = payload.repository as Record<string, unknown> | undefined;
  const repoData = repo?.owner as Record<string, unknown> | undefined;
  const repoConfig: RepoConfig = {
    owner: (repoData?.login as string) ?? "",
    name: (repo?.name as string) ?? "",
  };

  const prData = (payload.pull_request ?? payload.issue) as
    | Record<string, unknown>
    | undefined;
  const prNumber = (prData?.number as number) ?? null;
  const prUrl = (prData?.html_url as string) ?? (prData?.url as string) ?? "";

  const headRef = prData?.head as Record<string, unknown> | undefined;
  let branchName = (headRef?.ref as string) ?? "";

  if (!branchName && prNumber) {
    branchName = await fetchPrBranch(repoConfig, prNumber);
  }

  const sender = payload.sender as Record<string, unknown> | undefined;
  const githubLogin = (sender?.login as string) ?? "";

  const comment = (payload.comment ?? payload.review) as
    | Record<string, unknown>
    | undefined;
  const commentId = (comment?.id as number) ?? null;
  const nodeId =
    eventType === "pull_request_review"
      ? ((comment?.node_id as string) ?? null)
      : null;

  return [
    repoConfig,
    prNumber,
    branchName,
    githubLogin,
    prUrl,
    commentId,
    nodeId,
  ];
}

/**
 * Format PR comments into a human message for the agent.
 * @param comments - List of comments
 * @param prUrl - The PR URL
 * @returns Formatted prompt string
 */
export function buildPrPrompt(
  comments: GitHubComment[],
  prUrl: string,
): string {
  let commentsText = "";

  for (const c of comments) {
    const author = c.author ?? "unknown";
    const body = formatGithubCommentBodyForPrompt(author, c.body ?? "");

    if (c.type === "review_comment") {
      const path = c.path ?? "";
      const line = c.line ?? "";
      const loc = path ? ` (file: \`${path}\`, line: ${line})` : "";
      commentsText += `\n**${author}**${loc}:\n${body}\n`;
    } else {
      commentsText += `\n**${author}**:\n${body}\n`;
    }
  }
  return `You've been tagged in GitHub PR comments. Please resolve them.\n\nPR: ${prUrl}\n\n## Comments:\n${commentsText}\n\nIf code changes are needed:\n1. Make the changes in the sandbox\n2. Call \`commit_and_open_pr\` to push them to GitHub — this is REQUIRED, do NOT skip it\n3. Call \`github_comment\` with the PR number to post a summary on GitHub\n\nIf no code changes are needed:\n1. Call \`github_comment\` with the PR number to explain your answer — this is REQUIRED, never end silently\n\n**You MUST always call \`github_comment\` before finishing — whether or not changes were made.**`;
}
