import { createLogger } from "./logger";
import { mkdir, readFile, writeFile, unlink, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const logger = createLogger("memory-pointer");

// Configuration from environment
const MEMORY_POINTER_TTL_HOURS = Number.parseInt(
  process.env.MEMORY_POINTER_TTL_HOURS || "24",
  10,
);
const MEMORY_POINTER_DIR = process.env.MEMORY_POINTER_DIR || ".memory-pointers";
const MAX_POINTER_SIZE_TOKENS = Number.parseInt(
  process.env.MAX_POINTER_SIZE_TOKENS || "5000",
  10,
);

/**
 * Metadata stored with each artifact
 */
export interface ArtifactMetadata {
  id: string;
  threadId: string;
  type: string;
  timestamp: number;
  size: number;
  tokenCount: number;
  expiresAt: number;
  metadata: Record<string, unknown>;
}

/**
 * Stored artifact data
 */
export interface StoredArtifact {
  metadata: ArtifactMetadata;
  content: string;
}

/**
 * Query options for retrieving portions of artifacts
 */
export interface QueryOptions {
  type: "full" | "line-range" | "grep" | "summary";
  startLine?: number;
  endLine?: number;
  pattern?: string;
  caseInsensitive?: boolean;
  maxResults?: number;
}

/**
 * Result of an artifact query
 */
export interface QueryResult {
  content: string;
  truncated: boolean;
  originalSize: number;
  queryType: string;
}

/**
 * Validate a regex pattern to prevent ReDoS (Regular Expression Denial of Service).
 * Blocks patterns with nested repetition, multiple wildcards, or excessive length.
 */
function isValidPattern(pattern: string): boolean {
  // Limit pattern length
  if (pattern.length > 200) {
    return false;
  }

  // Block dangerous patterns that could cause exponential backtracking
  const dangerousPatterns = [
    /\([^)]*\+[^)]*\)+/, // Nested repetition like (a+)+b
    /\([^)]*\*[^)]*\)+/, // Nested repetition with *
    /\(\.\+|\.\*\)/, // Repeated wildcards like .+ or .*
    /\(.+\*\+.*\)/, // Multiple repetition operators
    /\(\[.*\{.*\]/, // Character class with repetition
  ];

  for (const dangerous of dangerousPatterns) {
    if (dangerous.test(pattern)) {
      return false;
    }
  }

  return true;
}

/**
 * Estimate token count for a string (rough approximation)
 * Uses ~4 characters per token as a heuristic
 */
function estimateTokens(str: string): number {
  return Math.ceil(str.length / 4);
}

/**
 * Generate a unique pointer ID
 */
function generatePointerId(): string {
  const bytes = randomBytes(8);
  return `ptr_${bytes.toString("base64url")}`;
}

/**
 * Get the file path for a pointer ID with validation.
 * @throws {Error} If pointer ID format is invalid
 */
function getPointerPath(pointerId: string): string {
  // Validate pointer ID format (ptr_ prefix followed by base64url characters)
  if (!pointerId || !/^ptr_[A-Za-z0-9_-]+$/.test(pointerId)) {
    throw new Error(`Invalid pointer ID format: ${pointerId}`);
  }

  // Additional length check to prevent path traversal via very long IDs
  if (pointerId.length > 100) {
    throw new Error(`Pointer ID too long: ${pointerId.length} characters`);
  }

  return path.join(MEMORY_POINTER_DIR, `${pointerId}.json`);
}

/**
 * Ensure the memory pointer directory exists
 */
async function ensureDirectory(): Promise<void> {
  if (!existsSync(MEMORY_POINTER_DIR)) {
    await mkdir(MEMORY_POINTER_DIR, { recursive: true });
    logger.debug(`Created memory pointer directory: ${MEMORY_POINTER_DIR}`);
  }
}

/**
 * Calculate expiration timestamp
 */
function getExpirationTimestamp(): number {
  return Date.now() + MEMORY_POINTER_TTL_HOURS * 60 * 60 * 1000;
}

/**
 * Check if an artifact has expired
 */
function isExpired(expiresAt: number): boolean {
  return Date.now() > expiresAt;
}

/**
 * Store an artifact and return a pointer ID.
 * Only stores if content exceeds the token threshold.
 *
 * @param threadId - Thread identifier for isolation
 * @param type - Type of artifact (e.g., "code-search-results", "fetch-url-response")
 * @param content - The content to store
 * @param metadata - Additional metadata about the artifact
 * @returns Pointer ID if stored, null if content was too small
 */
export async function storeArtifact(
  threadId: string,
  type: string,
  content: string,
  metadata: Record<string, unknown> = {},
): Promise<string | null> {
  const tokenCount = estimateTokens(content);

  // Only store if content exceeds threshold
  if (tokenCount <= MAX_POINTER_SIZE_TOKENS) {
    logger.debug(
      { threadId, type, tokenCount, threshold: MAX_POINTER_SIZE_TOKENS },
      "[memory-pointer] Content too small, skipping storage",
    );
    return null;
  }

  await ensureDirectory();

  const pointerId = generatePointerId();
  const artifact: StoredArtifact = {
    metadata: {
      id: pointerId,
      threadId,
      type,
      timestamp: Date.now(),
      size: content.length,
      tokenCount,
      expiresAt: getExpirationTimestamp(),
      metadata,
    },
    content,
  };

  const filePath = getPointerPath(pointerId);
  await writeFile(filePath, JSON.stringify(artifact), "utf-8");

  logger.info(
    {
      pointerId,
      threadId,
      type,
      size: content.length,
      tokenCount,
    },
    "[memory-pointer] Stored artifact",
  );

  return pointerId;
}

/**
 * Retrieve a stored artifact by pointer ID.
 * Validates thread ownership and expiration.
 *
 * @param pointerId - The pointer ID to retrieve
 * @param threadId - Thread ID for validation
 * @returns The stored artifact or null if not found/invalid
 */
export async function retrieveArtifact(
  pointerId: string,
  threadId: string,
): Promise<StoredArtifact | null> {
  const filePath = getPointerPath(pointerId);

  if (!existsSync(filePath)) {
    logger.warn({ pointerId }, "[memory-pointer] Artifact not found");
    return null;
  }

  try {
    const data = await readFile(filePath, "utf-8");
    const artifact: StoredArtifact = JSON.parse(data);

    // Validate thread ownership
    if (artifact.metadata.threadId !== threadId) {
      logger.warn(
        {
          pointerId,
          expectedThread: threadId,
          actualThread: artifact.metadata.threadId,
        },
        "[memory-pointer] Thread ownership validation failed",
      );
      return null;
    }

    // Check expiration
    if (isExpired(artifact.metadata.expiresAt)) {
      logger.debug(
        { pointerId },
        "[memory-pointer] Artifact expired, cleaning up",
      );
      await deleteArtifact(pointerId);
      return null;
    }

    return artifact;
  } catch (error) {
    logger.error(
      { pointerId, error },
      "[memory-pointer] Failed to retrieve artifact",
    );
    return null;
  }
}

/**
 * Query a specific portion of an artifact.
 * Useful for reading line ranges or searching within large artifacts.
 *
 * @param pointerId - The pointer ID to query
 * @param threadId - Thread ID for validation
 * @param options - Query options (line-range, grep, etc.)
 * @returns Query result with content
 */
export async function queryArtifact(
  pointerId: string,
  threadId: string,
  options: QueryOptions,
): Promise<QueryResult | null> {
  const artifact = await retrieveArtifact(pointerId, threadId);
  if (!artifact) {
    return null;
  }

  const { content } = artifact;
  const originalSize = content.length;

  switch (options.type) {
    case "full": {
      // Return full content (use with caution)
      return {
        content,
        truncated: false,
        originalSize,
        queryType: "full",
      };
    }

    case "line-range": {
      // Extract specific line range
      const start = options.startLine ?? 1;
      const end = options.endLine ?? start + 100;

      const lines = content.split("\n");
      const selectedLines = lines.slice(start - 1, end);

      return {
        content: selectedLines.join("\n"),
        truncated: end < lines.length,
        originalSize,
        queryType: "line-range",
      };
    }

    case "grep": {
      // Search for pattern within artifact
      const pattern = options.pattern;
      if (!pattern) {
        return null;
      }

      // Validate pattern to prevent ReDoS
      if (!isValidPattern(pattern)) {
        logger.warn(
          { pattern },
          "[memory-pointer] Invalid or unsafe regex pattern",
        );
        return null;
      }

      const flags = options.caseInsensitive ? "gi" : "g";
      const regex = new RegExp(pattern, flags);

      const lines = content.split("\n");
      const matches: string[] = [];
      const maxResults = options.maxResults ?? 50;

      for (const line of lines) {
        if (regex.test(line)) {
          matches.push(line);
          if (matches.length >= maxResults) {
            break;
          }
        }
      }

      return {
        content: matches.join("\n"),
        truncated: matches.length >= maxResults,
        originalSize,
        queryType: "grep",
      };
    }

    case "summary": {
      // Return a summary (first N lines, last N lines)
      const lines = content.split("\n");
      const headerLines = 20;
      const trailerLines = 10;

      let summary: string;
      if (lines.length <= headerLines + trailerLines) {
        summary = content;
      } else {
        const header = lines.slice(0, headerLines).join("\n");
        const trailer = lines.slice(-trailerLines).join("\n");
        const omitted = lines.length - headerLines - trailerLines;
        summary = `${header}\n\n... (${omitted} lines omitted) ...\n\n${trailer}`;
      }

      return {
        content: summary,
        truncated: true,
        originalSize,
        queryType: "summary",
      };
    }

    default:
      return null;
  }
}

/**
 * List all artifacts for a thread.
 *
 * @param threadId - Thread ID to list artifacts for
 * @returns Array of artifact metadata
 */
export async function listArtifacts(
  threadId: string,
): Promise<ArtifactMetadata[]> {
  await ensureDirectory();

  const files = await readdir(MEMORY_POINTER_DIR);

  const results = await Promise.all(
    files.map(async (file) => {
      if (!file.endsWith(".json")) {
        return null;
      }

      try {
        const filePath = path.join(MEMORY_POINTER_DIR, file);
        const data = await readFile(filePath, "utf-8");
        const artifact: StoredArtifact = JSON.parse(data);

        // Skip expired artifacts
        if (isExpired(artifact.metadata.expiresAt)) {
          await deleteArtifact(artifact.metadata.id);
          return null;
        }

        // Only return artifacts for this thread
        if (artifact.metadata.threadId === threadId) {
          // Don't include content in listing
          return artifact.metadata;
        }
      } catch (error) {
        logger.warn(
          { file, error },
          "[memory-pointer] Failed to read artifact during listing",
        );
      }
      return null;
    }),
  );

  return results.filter(
    (result): result is ArtifactMetadata => result !== null,
  );
}

/**
 * Delete a specific artifact.
 *
 * @param pointerId - The pointer ID to delete
 */
export async function deleteArtifact(pointerId: string): Promise<void> {
  const filePath = getPointerPath(pointerId);

  if (existsSync(filePath)) {
    await unlink(filePath);
    logger.debug({ pointerId }, "[memory-pointer] Deleted artifact");
  }
}

/**
 * Clean up all expired and old artifacts for a thread.
 *
 * @param threadId - Thread ID to clean up
 * @returns Number of artifacts cleaned up
 */
export async function cleanupArtifacts(threadId: string): Promise<number> {
  await ensureDirectory();

  const files = await readdir(MEMORY_POINTER_DIR);

  const results = await Promise.all(
    files.map(async (file) => {
      if (!file.endsWith(".json")) {
        return 0;
      }

      try {
        const filePath = path.join(MEMORY_POINTER_DIR, file);
        const data = await readFile(filePath, "utf-8");
        const artifact: StoredArtifact = JSON.parse(data);

        // Delete if expired or belongs to this thread
        if (
          isExpired(artifact.metadata.expiresAt) ||
          artifact.metadata.threadId === threadId
        ) {
          await unlink(filePath);
          return 1;
        }
      } catch (error) {
        logger.warn({ file, error }, "[memory-pointer] Failed during cleanup");
      }
      return 0;
    }),
  );

  const cleanedCount = results.reduce((sum, count) => sum + count, 0);

  if (cleanedCount > 0) {
    logger.info(
      { threadId, count: cleanedCount },
      "[memory-pointer] Cleaned up artifacts",
    );
  }

  return cleanedCount;
}

/**
 * Check if content should be stored as a memory pointer.
 *
 * @param content - Content to check
 * @returns true if content exceeds token threshold
 */
export function shouldStoreAsPointer(content: string): boolean {
  return estimateTokens(content) > MAX_POINTER_SIZE_TOKENS;
}

/**
 * Create a pointer reference message for the agent.
 * This is included in tool responses when content is stored as a pointer.
 */
export function createPointerReference(
  pointerId: string,
  metadata: ArtifactMetadata,
  tokenCount: number,
): string {
  return `[MEMORY POINTER: ${pointerId}]

Type: ${metadata.type}
Stored: ${new Date(metadata.timestamp).toISOString()}
Token count: ${tokenCount}
Original size: ${metadata.size} characters

This response has been stored as a memory pointer to reduce context usage.
Use the artifact-query tool to retrieve specific portions:
- Line range: artifact-query(pointer_id="${pointerId}", type="line-range", start_line=1, end_line=100)
- Pattern search: artifact-query(pointer_id="${pointerId}", type="grep", pattern="your-pattern")
- Summary: artifact-query(pointer_id="${pointerId}", type="summary")`;
}

/**
 * Store an artifact and return a formatted pointer reference string.
 * This is a convenience function that combines storeArtifact and createPointerReference.
 *
 * @param threadId - Thread identifier for isolation
 * @param type - Type of artifact (e.g., "code-search-results", "fetch-url-response")
 * @param content - The content to store
 * @param metadata - Additional metadata about the artifact
 * @returns Pointer reference string if stored, null if content was too small
 */
export async function storeArtifactAsPointer(
  threadId: string,
  type: string,
  content: string,
  metadata: Record<string, unknown> = {},
): Promise<string | null> {
  const tokenCount = estimateTokens(content);

  // Only store if content exceeds threshold
  if (tokenCount <= MAX_POINTER_SIZE_TOKENS) {
    return null;
  }

  await ensureDirectory();

  const pointerId = generatePointerId();
  const artifact: StoredArtifact = {
    metadata: {
      id: pointerId,
      threadId,
      type,
      timestamp: Date.now(),
      size: content.length,
      tokenCount,
      expiresAt: getExpirationTimestamp(),
      metadata,
    },
    content,
  };

  const filePath = getPointerPath(pointerId);
  await writeFile(filePath, JSON.stringify(artifact), "utf-8");

  logger.info(
    {
      pointerId,
      threadId,
      type,
      size: content.length,
      tokenCount,
    },
    "[memory-pointer] Stored artifact as pointer",
  );

  return createPointerReference(pointerId, artifact.metadata, tokenCount);
}
