import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createLogger } from "../utils/logger";
import { MemoryRepository } from "../memory/repository";

const logger = createLogger("memory-get");

// Configuration
const MEMORY_GET_ENABLED = process.env.MEMORY_GET_ENABLED !== "false";
const DEFAULT_RELATED_COUNT = 3;

/**
 * Retrieve a specific memory by ID.
 *
 * This tool fetches a single memory by its ID and optionally returns related memories.
 * Thread ownership is verified before returning results.
 *
 * **Best for:**
 * - Retrieving a specific memory found via memory_search
 * - Getting full details of a memory (beyond the preview)
 * - Accessing related memories for context
 *
 * **Not for:**
 * - Searching for memories (use memory_search instead)
 * - Creating new memories (handled automatically by the memory extraction system)
 *
 * Args:
 *   id: Memory ID to retrieve
 *   include_related: Whether to include related memories (default: true)
 *   related_count: Number of related memories to return (default: 3)
 *
 * Returns:
 *   Full memory details with optional related memories
 */
export const memoryGetTool = tool(
  async ({ id, include_related, related_count }, config) => {
    const threadId = config?.configurable?.thread_id;
    if (!threadId) {
      return JSON.stringify({
        error: "Missing thread_id in config. Memory retrieval requires a valid thread context.",
      });
    }

    if (!MEMORY_GET_ENABLED) {
      return JSON.stringify({
        error:
          "Memory retrieval is disabled. Set MEMORY_GET_ENABLED=true to enable.",
      });
    }

    if (!id || id.trim().length === 0) {
      return JSON.stringify({
        error: "Memory ID cannot be empty. Please provide a valid memory ID.",
      });
    }

    logger.info(
      { id, threadId, includeRelated: include_related },
      "[memory-get] Retrieving memory",
    );

    try {
      const repo = new MemoryRepository();

      // Get the memory by ID
      const memory = await repo.getById(id);

      if (!memory) {
        return JSON.stringify({
          error: `Memory with ID '${id}' not found.`,
          id,
        });
      }

      // Verify thread ownership
      if (memory.threadId !== threadId) {
        logger.warn(
          { id, memoryThread: memory.threadId, requestThread: threadId },
          "[memory-get] Thread ownership verification failed",
        );

        return JSON.stringify({
          error: "Access denied. Memory does not belong to the current thread.",
          id,
        });
      }

      // Check if memory is active
      if (memory.isActive === false) {
        return JSON.stringify({
          error: "Memory has been deleted and is no longer accessible.",
          id,
        });
      }

      const result: any = {
        id: memory.id,
        type: memory.type,
        title: memory.title,
        content: memory.content,
        metadata: memory.metadata,
        createdAt: memory.createdAt,
        accessCount: memory.accessCount || 0,
        lastAccessedAt: memory.lastAccessedAt,
      };

      // Optionally include related memories
      if (include_related) {
        const relatedLimit = related_count || DEFAULT_RELATED_COUNT;

        // Get all memories of the same type from this thread
        const sameTypeMemories = await repo.getByThread(threadId, [
          memory.type,
        ]);

        // Simple relatedness: same type, exclude current memory
        const related = sameTypeMemories
          .filter((m) => m.id !== id)
          .slice(0, relatedLimit)
          .map((m) => ({
            id: m.id,
            type: m.type,
            title: m.title,
            preview:
              m.content.substring(0, 150) +
              (m.content.length > 150 ? "..." : ""),
            createdAt: m.createdAt,
          }));

        result.related = related;
        result.relatedCount = related.length;
      }

      logger.info(
        { id, accessCount: memory.accessCount },
        "[memory-get] Memory retrieved successfully",
      );

      return JSON.stringify(result);
    } catch (error) {
      logger.error({ error, id }, "[memory-get] Retrieval failed");

      return JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Unknown error occurred during memory retrieval",
        id,
      });
    }
  },
  {
    name: "memory_get",
    description:
      "Retrieve a specific memory by ID with optional related memories. Verifies thread ownership before returning results.",
    schema: z.object({
      id: z.string().describe("Memory ID to retrieve"),
      include_related: z
        .boolean()
        .optional()
        .default(true)
        .describe("Whether to include related memories (default: true)"),
      related_count: z
        .number()
        .optional()
        .default(3)
        .describe("Number of related memories to return (default: 3)"),
    }),
  },
);
