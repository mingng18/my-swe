import { GITHUB_USER_EMAIL_MAP } from "./github/github-user-email-map";

/**
 * Unified Identity Map across all platforms.
 * Maps platform-specific handles to a single source of truth (email).
 *
 * Format: "<platform>:<identifier>" -> "user@example.com"
 * Example:
 *   "telegram:johndoe" -> "john@example.com"
 *   "github:johndoe" -> "john@example.com"
 *   "linear:abc-123" -> "john@example.com"
 */
export const IDENTITY_MAP: Record<string, string> = {
  // 1. Automatically import and prefix all GitHub mappings
  ...Object.fromEntries(
    Object.entries(GITHUB_USER_EMAIL_MAP).map(([githubUsername, email]) => [
      `github:${githubUsername}`,
      email,
    ])
  ),

  // 2. Add Telegram mappings here (username as returned by Telegram API, no @)
  "telegram:Minng02": "n.gihming@yahoo.com",

  // 3. Add Linear/Slack mappings here
  // "linear:uuid-1234": "your.email@example.com",
};

/**
 * Lookup an email given a platform and an identifier.
 */
export function getEmailForIdentity(platform: "github" | "telegram" | "linear" | "slack", identifier: string): string | undefined {
  // Some users might have the same handle on telegram as they do on github.
  // We can fallback to checking other platforms if needed, but explicit is better.
  return IDENTITY_MAP[`${platform}:${identifier}`];
}
