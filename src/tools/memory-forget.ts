import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createLogger } from "../utils/logger";
import { MemoryRepository } from "../memory/repository";

const logger = createLogger("memory-forget");

// Configuration
const MEMORY_FORGET_ENABLED = process.env.MEMORY_FORGET_ENABLED !== "false";

/**
 * Soft delete a memory (mark as inactive).
 *
 * This tool removes a memory from active use by marking it as inactive.
 * The memory is not permanently deleted and can be recovered if needed.
 * Thread ownership is verified before deletion.
 *
 * **Best for:**
 * - Removing incorrect or outdated memories
 * - Cleaning up irrelevant information
 * - Correcting memory extraction errors
 *
 * **Not for:**
 * - Searching memories (use memory_search instead)
 * - Retrieving memories (use memory_get instead)
 * - Creating new memories (handled automatically)
 *
 * Args:
 *   id: Memory ID to forget (soft delete)
 *   reason: Optional reason for deletion (for audit purposes)
 *
 * Returns:
 *   Confirmation of deletion with audit information
 */
export const memoryForgetTool = tool(
  async ({ id, reason }, config) => {
    const threadId = config?.configurable?.thread_id;
    if (!threadId) {
      return JSON.stringify({
        error: "Missing thread_id in config. Memory deletion requires a valid thread context.",
      });
    }

    if (!MEMORY_FORGET_ENABLED) {
      return JSON.stringify({
        error:
          "Memory deletion is disabled. Set MEMORY_FORGET_ENABLED=true to enable.",
      });
    }

    if (!id || id.trim().length === 0) {
      return JSON.stringify({
        error: "Memory ID cannot be empty. Please provide a valid memory ID.",
      });
    }

    logger.info(
      { id, threadId, reason },
      "[memory-forget] Soft deleting memory",
    );

    try {
      const repo = new MemoryRepository();

      // First, get the memory to verify ownership
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
          "[memory-forget] Thread ownership verification failed",
        );

        return JSON.stringify({
          error: "Access denied. Memory does not belong to the current thread.",
          id,
        });
      }

      // Check if already inactive
      if (memory.isActive === false) {
        return JSON.stringify({
          message: "Memory was already deleted and is inactive.",
          id,
          alreadyDeleted: true,
        });
      }

      // Perform soft delete
      await repo.softDelete(id);

      // Log the deletion with audit information
      logger.info(
        {
          id,
          threadId,
          memoryType: memory.type,
          memoryTitle: memory.title,
          reason,
        },
        "[memory-forget] Memory soft deleted successfully",
      );

      return JSON.stringify({
        success: true,
        id,
        message: "Memory has been marked as inactive and will not appear in search results.",
        memoryType: memory.type,
        memoryTitle: memory.title,
        deletedAt: new Date().toISOString(),
        reason: reason || null,
      });
    } catch (error) {
      logger.error({ error, id }, "[memory-forget] Deletion failed");

      return JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Unknown error occurred during memory deletion",
        id,
      });
    }
  },
  {
    name: "memory_forget",
    description:
      "Soft delete a memory by marking it as inactive. The memory is not permanently deleted and can be recovered if needed. Verifies thread ownership before deletion.",
    schema: z.object({
      id: z.string().describe("Memory ID to forget (soft delete)"),
      reason: z
        .string()
        .optional()
        .describe("Optional reason for deletion (for audit purposes)"),
    }),
  },
);
