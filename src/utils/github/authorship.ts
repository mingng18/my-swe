/**
 * Authorship utilities for GitHub commits and PRs.
 *
 * Handles user identity resolution, co-authorship attribution,
 * and PR collaboration notes to properly credit contributors.
 */

import { getEmailForIdentity } from "../identity";

const OPEN_SWE_BOT_NAME = "open-swe[bot]";
const OPEN_SWE_BOT_EMAIL = "open-swe@users.noreply.github.com";

/**
 * User identity information for attribution.
 */
export interface UserIdentity {
  /** User's display name */
  name?: string;
  /** User's email address */
  email?: string;
  /** User's GitHub username */
  githubUsername?: string;
  /** User's Telegram username */
  telegramUsername?: string;
  /** User's Linear handle */
  linearUsername?: string;
  /** Whether this identity was resolved from a known mapping */
  isResolved?: boolean;
}

/**
 * Resolve the triggering user's identity from LangGraph config.
 *
 * Looks for user information in config.metadata in this priority order:
 * 1. Direct metadata fields (github_username, telegram_username, etc.)
 * 2. Transport-specific fields (telegram_user, github_user)
 *
 * @param config - LangGraph config object
 * @param githubToken - Optional GitHub token for API lookups
 * @returns User identity object
 */
export function resolveTriggeringUserIdentity(
  config: Record<string, unknown>,
  githubToken?: string,
): UserIdentity {
  const metadata = (config.metadata ?? {}) as Record<string, unknown>;

  // Try to resolve from explicit metadata fields
  const identity: UserIdentity = {
    githubUsername: getStringField(metadata, "github_username") ||
                    getStringField(metadata, "github_user") ||
                    getStringField(metadata, "githubUsername"),
    telegramUsername: getStringField(metadata, "telegram_username") ||
                     getStringField(metadata, "telegram_user") ||
                     getStringField(metadata, "telegramUsername"),
    linearUsername: getStringField(metadata, "linear_username") ||
                   getStringField(metadata, "linear_user") ||
                   getStringField(metadata, "linearUsername"),
    name: getStringField(metadata, "user_name") ||
          getStringField(metadata, "userName") ||
          getStringField(metadata, "name"),
  };

  // Try to resolve email from known mappings
  if (identity.githubUsername) {
    const email = getEmailForIdentity("github", identity.githubUsername);
    if (email) {
      identity.email = email;
      identity.isResolved = true;
    }
  }

  if (!identity.email && identity.telegramUsername) {
    const email = getEmailForIdentity("telegram", identity.telegramUsername);
    if (email) {
      identity.email = email;
      identity.isResolved = true;
    }
  }

  return identity;
}

/**
 * Add a co-author trailer to a commit message.
 *
 * Git co-author trailers follow the format:
 *   Co-Authored-By: Name <email>
 *
 * This adds proper attribution in git history for commits made on behalf
 * of a user (e.g., via a bot or automation).
 *
 * @param commitMessage - The original commit message
 * @param userIdentity - User identity to add as co-author
 * @returns Commit message with co-author trailer appended
 */
export function addUserCoauthorTrailer(
  commitMessage: string,
  userIdentity: UserIdentity,
): string {
  const { name, email } = userIdentity;

  // Only add co-author if we have valid email
  if (!email) {
    return commitMessage;
  }

  // Build the co-author trailer
  const namePart = name ? `${name} ` : "";
  const trailer = `Co-Authored-By: ${namePart}<${email}>`;

  // Add trailer to commit message
  return `${commitMessage}\n\n${trailer}`;
}

/**
 * Add a PR collaboration note to the PR body.
 *
 * This appends a note at the end of the PR description indicating
 * who triggered/created this PR (useful for bot-initiated workflows).
 *
 * @param prBody - The original PR body
 * @param userIdentity - User identity to attribute in the note
 * @returns PR body with collaboration note appended
 */
export function addPrCollaborationNote(
  prBody: string,
  userIdentity: UserIdentity,
): string {
  const { githubUsername, telegramUsername, name, isResolved } = userIdentity;

  // If we couldn't resolve the user identity, don't add a note
  if (!githubUsername && !telegramUsername && !name) {
    return prBody;
  }

  // Build attribution string
  let attribution = "";
  if (githubUsername) {
    attribution = `@${githubUsername}`;
  } else if (telegramUsername) {
    attribution = `Telegram user @${telegramUsername}`;
  } else if (name) {
    attribution = name;
  }

  const note = `\n\n---\n\n*This PR was created on behalf of ${attribution}.${isResolved ? "" : " (identity unconfirmed)"}*`;

  return `${prBody}${note}`;
}

/**
 * Get a string field from metadata, returning undefined if not a string.
 */
function getStringField(
  metadata: Record<string, unknown>,
  fieldName: string,
): string | undefined {
  const value = metadata[fieldName];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export { OPEN_SWE_BOT_NAME, OPEN_SWE_BOT_EMAIL };
