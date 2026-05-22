import { createLogger } from "../logger";
import { MAX_POINTER_SIZE_TOKENS } from "./config";
import type { ArtifactMetadata, StoredArtifact } from "./types";
import { estimateTokens, generatePointerId, getExpirationTimestamp, getPointerPath } from "./utils";
import { ensureDirectory } from "./storage";
import { writeFile } from "node:fs/promises";

const logger = createLogger("memory-pointer");

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
