/**
 * GitHub token lookup utilities.
 *
 * Resolves GitHub tokens from run metadata or thread metadata.
 * Uses LangGraph client for thread metadata access.
 */

import { Client } from "@langchain/langgraph-sdk";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const logger = console;

const GITHUB_TOKEN_METADATA_KEY = "github_token_encrypted";
const TOKEN_KEY_ENV = "GITHUB_TOKEN_ENCRYPTION_KEY";
const IV_LENGTH = 12;

function getEncryptionKey(): Buffer | null {
  const raw = process.env[TOKEN_KEY_ENV]?.trim();
  if (!raw) return null;
  return createHash("sha256").update(raw).digest();
}

/**
 * Read encrypted GitHub token from metadata.
 * @param metadata - The metadata object
 * @returns Encrypted token string if present, null otherwise
 */
function readEncryptedGithubToken(metadata: Record<string, unknown>): string | null {
  const encryptedToken = metadata[GITHUB_TOKEN_METADATA_KEY];
  return typeof encryptedToken === "string" && encryptedToken ? encryptedToken : null;
}

/**
 * Decrypt an encrypted GitHub token.
 * Note: This requires an implementation of decryptToken from an encryption utility module.
 * @param encryptedToken - The encrypted token string
 * @returns Decrypted token string, or null if decryption fails
 */
function decryptGithubToken(encryptedToken: string | null): string | null {
  if (!encryptedToken) {
    return null;
  }

  try {
    const key = getEncryptionKey();
    if (!key) {
      logger.warn(
        `[github_token] ${TOKEN_KEY_ENV} is not set; refusing to decrypt thread metadata token`,
      );
      return null;
    }
    const payload = Buffer.from(encryptedToken, "base64");
    const iv = payload.subarray(0, IV_LENGTH);
    const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + 16);
    const ciphertext = payload.subarray(IV_LENGTH + 16);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8");
  } catch (error) {
    logger.error("[github_token] Failed to decrypt GitHub token:", error);
    return null;
  }
}

/**
 * Resolve a GitHub token from run metadata.
 * This function should be called within a LangGraph run context.
 * @returns GitHub token string, or null if not available
 */
export function getGithubToken(): string | null {
  // Note: In Python's LangGraph, get_config() provides access to run metadata.
  // In TypeScript/JavaScript, you would typically pass metadata as a parameter
  // or use a context provider. Adjust this implementation based on your setup.

  try {
    // Placeholder implementation - in practice, you'd get this from:
    // 1. Direct parameter passing
    // 2. AsyncLocalStorage (Node.js)
    // 3. A context object from LangGraph

    // For now, check environment variable as fallback
    const token = process.env.GITHUB_TOKEN?.trim();
    return token ?? null;
  } catch (error) {
    logger.error("[github_token] Failed to get GitHub token from config:", error);
    return null;
  }
}

/**
 * Resolve a GitHub token from LangGraph thread metadata.
 * @param threadId - The LangGraph thread ID
 * @returns Tuple of [token, encryptedToken] - either value may be null
 */
export async function getGithubTokenFromThread(
  threadId: string,
): Promise<[string | null, string | null]> {
  try {
    const client = new Client({ apiUrl: process.env.LANGGRAPH_API_URL });

    const thread = await client.threads.get(threadId);
    const metadata = thread.metadata ?? {};
    const encryptedToken = readEncryptedGithubToken(metadata as Record<string, unknown>);
    const token = decryptGithubToken(encryptedToken);

    if (token) {
      logger.info(`[github_token] Found GitHub token in thread metadata for thread ${threadId}`);
    }

    return [token, encryptedToken];
  } catch (error: unknown) {
    const isNotFound = error instanceof Error && "message" in error && "code" in error;
    if (isNotFound) {
      logger.debug(`[github_token] Thread ${threadId} not found while looking up GitHub token`);
    } else {
      logger.error(`[github_token] Failed to fetch thread metadata for ${threadId}:`, error);
    }
    return [null, null];
  }
}

/**
 * Set encrypted GitHub token in thread metadata.
 * @param threadId - The LangGraph thread ID
 * @param encryptedToken - The encrypted token string
 * @returns True if successful
 */
export async function setGithubTokenInThread(
  threadId: string,
  encryptedToken: string,
): Promise<boolean> {
  try {
    const client = new Client({ apiUrl: process.env.LANGGRAPH_API_URL });

    await client.threads.update(threadId, {
      metadata: {
        [GITHUB_TOKEN_METADATA_KEY]: encryptedToken,
      },
    });

    return true;
  } catch (error) {
    logger.error(`[github_token] Failed to set GitHub token in thread ${threadId}:`, error);
    return false;
  }
}

/**
 * Encrypt and store a GitHub token in thread metadata.
 * @param threadId - The LangGraph thread ID
 * @param token - The plain text GitHub token
 * @returns True if successful
 */
export async function storeGithubTokenInThread(
  threadId: string,
  token: string,
): Promise<boolean> {
  try {
    const key = getEncryptionKey();
    if (!key) {
      logger.error(
        `[github_token] ${TOKEN_KEY_ENV} is required to store GitHub token in thread metadata`,
      );
      return false;
    }
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const encryptedToken = Buffer.concat([iv, authTag, ciphertext]).toString(
      "base64",
    );

    return await setGithubTokenInThread(threadId, encryptedToken);
  } catch (error) {
    logger.error(`[github_token] Failed to encrypt and store GitHub token:`, error);
    return false;
  }
}
