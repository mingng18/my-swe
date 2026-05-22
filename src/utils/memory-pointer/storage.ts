import { mkdir, readFile, writeFile, unlink, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createLogger } from "../logger";
import { MEMORY_POINTER_DIR, MAX_POINTER_SIZE_TOKENS } from "./config";
import type { ArtifactMetadata, StoredArtifact, UpdateOptions } from "./types";
import {
  estimateTokens,
  generatePointerId,
  getExpirationTimestamp,
  getPointerPath,
  isExpired,
} from "./utils";

const logger = createLogger("memory-pointer");

/**
 * Ensure the memory pointer directory exists
 */
export async function ensureDirectory(): Promise<void> {
  if (!existsSync(MEMORY_POINTER_DIR)) {
    await mkdir(MEMORY_POINTER_DIR, { recursive: true });
    logger.debug(`Created memory pointer directory: ${MEMORY_POINTER_DIR}`);
  }
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
 * Update an existing artifact.
 * Validates thread ownership and expiration.
 *
 * @param pointerId - The pointer ID to update
 * @param threadId - Thread ID for validation
 * @param options - Update options (content, metadata, type)
 * @returns The updated artifact or null if not found/invalid
 */
export async function updateArtifact(
  pointerId: string,
  threadId: string,
  options: UpdateOptions,
): Promise<StoredArtifact | null> {
  const filePath = getPointerPath(pointerId);

  if (!existsSync(filePath)) {
    logger.warn({ pointerId }, "[memory-pointer] Artifact not found for update");
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
        "[memory-pointer] Artifact expired, cannot update",
      );
      return null;
    }

    // Update content if provided
    if (options.content !== undefined) {
      artifact.content = options.content;
    }

    // Merge metadata if provided
    if (options.metadata !== undefined) {
      artifact.metadata.metadata = {
        ...artifact.metadata.metadata,
        ...options.metadata,
      };
    }

    // Update type if provided
    if (options.type !== undefined) {
      artifact.metadata.type = options.type;
    }

    // Recalculate size and token count
    artifact.metadata.size = artifact.content.length;
    artifact.metadata.tokenCount = estimateTokens(artifact.content);
    artifact.metadata.timestamp = Date.now();

    // Write updated artifact back to file
    await writeFile(filePath, JSON.stringify(artifact), "utf-8");

    logger.info(
      {
        pointerId,
        threadId,
        size: artifact.metadata.size,
        tokenCount: artifact.metadata.tokenCount,
      },
      "[memory-pointer] Updated artifact",
    );

    return artifact;
  } catch (error) {
    logger.error(
      { pointerId, error },
      "[memory-pointer] Failed to update artifact",
    );
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
  const artifacts: ArtifactMetadata[] = [];

  const readPromises = files
    .filter((file) => file.endsWith(".json"))
    .map(async (file) => {
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
          return artifact.metadata;
        }
      } catch (error) {
        logger.warn(
          { file, error },
          "[memory-pointer] Failed to read artifact during listing",
        );
      }
      return null;
    });

  const results = await Promise.all(readPromises);
  for (const metadata of results) {
    if (metadata) {
      artifacts.push(metadata);
    }
  }

  return artifacts;
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
  let cleanedCount = 0;

  const cleanupPromises = files
    .filter((file) => file.endsWith(".json"))
    .map(async (file) => {
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
    });

  const results = await Promise.all(cleanupPromises);
  cleanedCount = results.reduce((sum: number, count) => sum + count, 0);

  if (cleanedCount > 0) {
    logger.info(
      { threadId, count: cleanedCount },
      "[memory-pointer] Cleaned up artifacts",
    );
  }

  return cleanedCount;
}
