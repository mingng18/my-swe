/**
 * GitHub App installation token generation.
 *
 * Generates JWTs and exchanges them for installation access tokens
 * using GitHub App authentication.
 */

import { createPrivateKey, createSign } from "node:crypto";

const logger = console;

const GITHUB_APP_ID = process.env.GITHUB_APP_ID?.trim() ?? "";
const GITHUB_APP_PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY?.trim() ?? "";
const GITHUB_APP_INSTALLATION_ID = process.env.GITHUB_APP_INSTALLATION_ID?.trim() ?? "";

interface InstallationTokenResponse {
  token: string;
  expires_at: string;
  permissions?: Record<string, string>;
  repository_selection?: string;
}

interface GitHubErrorResponse {
  message?: string;
  error?: string;
  errors?: Array<{
    resource?: string;
    field?: string;
    code?: string;
    message?: string;
  }>;
}

/**
 * Generate a short-lived JWT signed with the GitHub App private key.
 * @returns The JWT string
 */
function generateAppJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60, // issued 60s ago to account for clock skew
    exp: now + 540, // expires in 9 minutes (max is 10)
    iss: GITHUB_APP_ID,
  };

  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const base64UrlEncode = (str: string): string => {
    return Buffer.from(str)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));

  const privateKey = createPrivateKey({
    key: GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
    format: "pem",
  });

  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signatureInput);
  sign.end();

  const signature = sign.sign(privateKey);
  const encodedSignature = base64UrlEncode(signature.toString("base64"));

  return `${signatureInput}.${encodedSignature}`;
}

/**
 * Exchange the GitHub App JWT for an installation access token.
 * @returns Installation access token string, or null if unavailable
 */
export async function getGithubAppInstallationToken(): Promise<string | null> {
  if (!GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY || !GITHUB_APP_INSTALLATION_ID) {
    logger.debug("[github_app] GitHub App env vars not fully configured, skipping app token");
    return null;
  }

  try {
    const appJwt = generateAppJwt();

    const response = await fetch(
      `https://api.github.com/app/installations/${GITHUB_APP_INSTALLATION_ID}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );

    if (!response.ok) {
      const errorData = (await response.json()) as GitHubErrorResponse;
      logger.error(`[github_app] Failed to get installation token: ${response.status}`, errorData);
      return null;
    }

    const data = (await response.json()) as InstallationTokenResponse;
    return data.token;
  } catch (error) {
    logger.error("[github_app] Failed to get GitHub App installation token:", error);
    return null;
  }
}
