import { createLogger } from "../utils/logger";
import { MemoryRepository } from "./repository";
import type { Memory, ConsolidationResult, MemoryType } from "./types";

const logger = createLogger("consolidation-service");

/**
 * Similarity threshold for duplicate detection (default: 0.9)
 */
const DEFAULT_SIMILARITY_THRESHOLD = 0.9;

/**
 * Default stale memory threshold in days (default: 90)
 */
const DEFAULT_STALE_DAYS = 90;

/**
 * Service for consolidating memories by finding duplicates and cleaning up stale entries
 */
export class ConsolidationService {
  constructor(
    private repository: MemoryRepository,
    private embeddingService: {
      generateEmbedding(text: string): Promise<number[]>;
      cosineSimilarity(a: number[], b: number[]): number;
    },
  ) {}

  /**
   * Consolidate memories for a thread by finding duplicates and cleaning up stale entries
   */
  async consolidate(threadId: string): Promise<ConsolidationResult> {
    const result: ConsolidationResult = {
      processed: 0,
      merged: 0,
      archived: 0,
      errors: [],
    };

    try {
      // Get all memories for the thread
      const memories = await this.repository.getByThread(threadId);
      result.processed = memories.length;

      if (memories.length === 0) {
        return result;
      }

      // Find and merge duplicates
      const duplicateGroups = await this.findDuplicates(threadId);
      for (const group of duplicateGroups) {
        try {
          const mergeResult = await this.mergeDuplicateGroup(group);
          result.merged += mergeResult.merged;
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          result.errors.push(`Failed to merge duplicates: ${errorMsg}`);
          logger.error({ error, threadId }, "Failed to merge duplicate group");
        }
      }

      // Find and archive stale memories
      const staleMemories = await this.findStaleMemories(threadId);
      for (const memory of staleMemories) {
        try {
          await this.repository.softDelete(memory.id!);
          result.archived++;
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          result.errors.push(
            `Failed to archive stale memory ${memory.id}: ${errorMsg}`,
          );
          logger.error(
            { error, memoryId: memory.id },
            "Failed to archive stale memory",
          );
        }
      }

      logger.info(
        {
          threadId,
          processed: result.processed,
          merged: result.merged,
          archived: result.archived,
          errors: result.errors.length,
        },
        "Consolidation completed",
      );

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.errors.push(`Consolidation failed: ${errorMsg}`);
      logger.error({ error, threadId }, "Consolidation failed");
      return result;
    }
  }

  /**
   * Find duplicate memories based on similarity threshold
   */
  async findDuplicates(
    threadId: string,
    similarityThreshold: number = DEFAULT_SIMILARITY_THRESHOLD,
  ): Promise<Memory[][]> {
    const memories = await this.repository.getByThread(threadId);
    const duplicateGroups: Memory[][] = [];
    const processed = new Set<string>();

    // Generate embeddings for memories that don't have them
    for (const memory of memories) {
      if (!memory.embedding || memory.embedding.length === 0) {
        try {
          const text = `${memory.title}. ${memory.content}`;
          memory.embedding =
            await this.embeddingService.generateEmbedding(text);
          await this.repository.update(memory.id!, {
            embedding: memory.embedding,
          });
        } catch (error) {
          logger.warn(
            { memoryId: memory.id },
            "Failed to generate embedding for duplicate detection",
          );
          continue;
        }
      }
    }

    // Find duplicate groups
    for (let i = 0; i < memories.length; i++) {
      const memory1 = memories[i];
      if (processed.has(memory1.id!)) continue;

      const group: Memory[] = [memory1];

      for (let j = i + 1; j < memories.length; j++) {
        const memory2 = memories[j];
        if (processed.has(memory2.id!)) continue;

        // Only compare memories of the same type
        if (memory1.type !== memory2.type) continue;

        // Calculate similarity
        if (memory1.embedding && memory2.embedding) {
          let similarity = 0;
          try {
            // Try to use the cosineSimilarity method if available
            if (typeof this.embeddingService.cosineSimilarity === "function") {
              similarity = this.embeddingService.cosineSimilarity(
                memory1.embedding,
                memory2.embedding,
              );
            } else {
              // Fallback to EmbeddingService static method
              const { EmbeddingService } = await import("./embeddings");
              similarity = EmbeddingService.cosineSimilarity(
                memory1.embedding,
                memory2.embedding,
              );
            }
          } catch (error) {
            logger.warn(
              { error },
              "Failed to calculate similarity, using fallback",
            );
            // Simple dot product as fallback
            similarity = this.calculateCosineSimilarity(
              memory1.embedding,
              memory2.embedding,
            );
          }

          if (similarity >= similarityThreshold) {
            group.push(memory2);
            processed.add(memory2.id!);
          }
        }
      }

      if (group.length > 1) {
        duplicateGroups.push(group);
        processed.add(memory1.id!);
      }
    }

    return duplicateGroups;
  }

  /**
   * Calculate cosine similarity as fallback
   */
  private calculateCosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have the same length");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
      throw new Error("Vectors cannot have zero magnitude");
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Merge a group of duplicate memories into a single memory
   */
  async mergeDuplicateGroup(memories: Memory[]): Promise<ConsolidationResult> {
    const result: ConsolidationResult = {
      processed: memories.length,
      merged: 0,
      archived: 0,
      errors: [],
    };

    if (memories.length <= 1) {
      return result;
    }

    try {
      // Sort by access count and creation date to find the best memory to keep
      const sorted = [...memories].sort((a, b) => {
        // Prefer higher access count
        const accessDiff = (b.accessCount || 0) - (a.accessCount || 0);
        if (accessDiff !== 0) return accessDiff;

        // Prefer more recent
        const dateA = a.createdAt?.getTime() || 0;
        const dateB = b.createdAt?.getTime() || 0;
        return dateB - dateA;
      });

      const [keep, ...toDelete] = sorted;

      // Merge metadata
      const mergedMetadata: Record<string, unknown> = { ...keep.metadata };
      for (const memory of toDelete) {
        Object.assign(mergedMetadata, memory.metadata);
      }

      // Merge content (keep the most detailed one)
      const mergedContent = sorted.reduce((longest, current) => {
        return current.content.length > longest.length
          ? current.content
          : longest;
      }, keep.content);

      // Update the kept memory
      await this.repository.update(keep.id!, {
        content: mergedContent,
        metadata: mergedMetadata,
      });

      // Soft delete the duplicates
      for (const memory of toDelete) {
        await this.repository.softDelete(memory.id!);
      }

      result.merged = toDelete.length;
      logger.info(
        {
          keptMemoryId: keep.id,
          deletedCount: toDelete.length,
        },
        "Merged duplicate memories",
      );

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.errors.push(`Merge failed: ${errorMsg}`);
      logger.error({ error }, "Failed to merge duplicate group");
      return result;
    }
  }

  /**
   * Find stale memories older than the specified threshold
   */
  async findStaleMemories(
    threadId: string,
    staleDays: number = DEFAULT_STALE_DAYS,
  ): Promise<Memory[]> {
    const memories = await this.repository.getByThread(threadId);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - staleDays);

    const staleMemories = memories.filter((memory) => {
      const createdAt = memory.createdAt;
      if (!createdAt) return false;

      // Check if memory is old enough
      if (createdAt < cutoffDate) {
        // Also check if it hasn't been accessed recently
        const lastAccessed = memory.lastAccessedAt || createdAt;
        return lastAccessed < cutoffDate;
      }

      return false;
    });

    return staleMemories;
  }

  /**
   * Resolve time references in memory content (e.g., "yesterday", "last week")
   */
  resolveTimeReferences(content: string): string {
    const now = new Date();
    let resolved = content;

    // Common time reference patterns
    const patterns = [
      {
        regex: /\byesterday\b/gi,
        replace: () => {
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          return yesterday.toISOString().split("T")[0];
        },
      },
      {
        regex: /\btoday\b/gi,
        replace: () => now.toISOString().split("T")[0],
      },
      {
        regex: /\blast week\b/gi,
        replace: () => {
          const lastWeek = new Date(now);
          lastWeek.setDate(lastWeek.getDate() - 7);
          return `the week of ${lastWeek.toISOString().split("T")[0]}`;
        },
      },
      {
        regex: /\blast month\b/gi,
        replace: () => {
          const lastMonth = new Date(now);
          lastMonth.setMonth(lastMonth.getMonth() - 1);
          return lastMonth.toLocaleString("default", {
            month: "long",
            year: "numeric",
          });
        },
      },
      {
        regex: /\bN days ago\b/gi,
        replace: () => {
          // This is a placeholder - would need more sophisticated parsing
          return "recently";
        },
      },
    ];

    for (const pattern of patterns) {
      resolved = resolved.replace(pattern.regex, pattern.replace);
    }

    return resolved;
  }
}
