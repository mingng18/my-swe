import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createLogger } from "../utils/logger";
import { MemoryRepository } from "../memory/repository";
import type { MemoryType } from "../memory/types";
import { GenericCache } from "../utils/cache/lru-cache";

const logger = createLogger("memory-search");

// Configuration
const MEMORY_SEARCH_ENABLED = process.env.MEMORY_SEARCH_ENABLED !== "false";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

// Cache configuration
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CACHE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB

/**
 * Memory search cache with LRU eviction.
 *
 * Wraps the GenericCache to provide a memory-search-specific caching interface
 * with enhanced statistics and pattern-based invalidation.
 */
class MemorySearchCache {
  private cache: GenericCache;

  constructor() {
    this.cache = new GenericCache({
      maxSize: MAX_CACHE_SIZE_BYTES,
      ttl: CACHE_TTL_MS,
      debug: "memory-search-cache",
    });
  }

  /**
   * Get a cached value.
   */
  get<T>(threadId: string, query: string, types?: MemoryType[]): T | null {
    return this.cache.get<T>(this.makeKey(threadId, query, types));
  }

  /**
   * Set a cached value.
   */
  set<T>(threadId: string, query: string, data: T, types?: MemoryType[]): void {
    this.cache.set(this.makeKey(threadId, query, types), data);
  }

  /**
   * Invalidate cache entries matching a pattern.
   */
  invalidate(pattern: string): void {
    this.cache.invalidate(pattern);
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics.
   */
  getStats() {
    return this.cache.getStats();
  }

  /**
   * Create a cache key from parameters.
   */
  private makeKey(threadId: string, query: string, types?: MemoryType[]): string {
    const typesKey = types ? `:${types.sort().join(",")}` : "";
    return `memory:${threadId}:${query}${typesKey}`;
  }
}

// Global cache instance
export const memorySearchCache = new MemorySearchCache();

/**
 * Simple keyword-based search for memories.
 * This is an MVP implementation that uses basic keyword matching.
 *
 * For production use, this should be replaced with:
 * - Full-text search (PostgreSQL tsvector)
 * - Vector similarity search (embeddings)
 * - Hybrid search (keyword + vector)
 */
function keywordMatch(query: string, text: string): number {
  if (!query || !text) return 0;

  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 2);

  if (queryTerms.length === 0) return 0;

  const searchText = text.toLowerCase();
  let matchCount = 0;

  for (const term of queryTerms) {
    if (searchText.includes(term)) {
      matchCount++;
    }
  }

  // Return relevance score (0-1)
  return matchCount / queryTerms.length;
}

/**
 * Search memories by keyword query.
 *
 * This tool allows you to search through stored memories using keyword queries.
 * Results are ranked by relevance and filtered to the current thread.
 *
 * **Best for:**
 * - Finding previously learned information
 * - Retrieving project context
 * - Accessing user preferences and feedback
 *
 * **Not for:**
 * - Searching code files (use semantic_search or code_search)
 * - Searching web content (use web_search)
 *
 * Args:
 *   query: Search query (keywords or phrases)
 *   types: Optional array of memory types to filter (user, feedback, project, reference)
 *   limit: Maximum number of results to return (default: 10, max: 50)
 *   hybrid: Use hybrid search (keyword + semantic) if available (default: false)
 *
 * Returns:
 *   Array of memory search results with relevance scores
 */
export const memorySearchTool = tool(
  async ({ query, types, limit, hybrid }, config) => {
    const threadId = config?.configurable?.thread_id;
    if (!threadId) {
      return JSON.stringify({
        error: "Missing thread_id in config. Memory search requires a valid thread context.",
      });
    }

    if (!MEMORY_SEARCH_ENABLED) {
      return JSON.stringify({
        error:
          "Memory search is disabled. Set MEMORY_SEARCH_ENABLED=true to enable.",
      });
    }

    if (!query || query.trim().length === 0) {
      return JSON.stringify({
        error: "Query cannot be empty. Please provide a search query.",
      });
    }

    const resultLimit = Math.min(limit || DEFAULT_LIMIT, MAX_LIMIT);

    logger.info(
      { query, types, limit: resultLimit, hybrid, threadId },
      "[memory-search] Searching memories",
    );

    try {
      // Check cache for existing results
      const cacheKeyParams = {
        limit: resultLimit,
        types: types || null,
      };
      const cached = memorySearchCache.get<
        { matches: unknown[]; total: number; query: string; types: MemoryType[] | null }
      >(threadId, query, types);

      if (cached !== null) {
        logger.debug(
          { query, threadId, cacheHits: cached.total },
          "[memory-search] Cache hit",
        );

        // Return cached result with limit applied
        const limitedMatches = cached.matches.slice(0, resultLimit);
        return JSON.stringify({
          ...cached,
          matches: limitedMatches,
          total: limitedMatches.length,
        });
      }

      logger.debug(
        { query, threadId },
        "[memory-search] Cache miss, executing search",
      );

      const repo = new MemoryRepository();

      // Fetch all memories for this thread (with optional type filter)
      const memories = await repo.getByThread(threadId, types);

      if (memories.length === 0) {
        const emptyResult = {
          matches: [],
          total: 0,
          query,
          message: "No memories found for this thread",
        };

        // Cache empty result
        memorySearchCache.set(threadId, query, emptyResult, types);

        return JSON.stringify(emptyResult);
      }

      // Score and rank memories using keyword matching
      const scored = memories
        .map((memory) => {
          // Search in title and content
          const titleScore = keywordMatch(query, memory.title);
          const contentScore = keywordMatch(query, memory.content);
          const metadataScore = keywordMatch(
            query,
            JSON.stringify(memory.metadata),
          );

          // Weight content higher than title and metadata
          const relevanceScore =
            titleScore * 0.3 + contentScore * 0.6 + metadataScore * 0.1;

          return {
            id: memory.id,
            type: memory.type,
            title: memory.title,
            preview:
              memory.content.substring(0, 200) +
              (memory.content.length > 200 ? "..." : ""),
            relevanceScore,
            createdAt: memory.createdAt,
            metadata: memory.metadata,
          };
        })
        .filter((result) => result.relevanceScore > 0)
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, resultLimit);

      const result = {
        matches: scored,
        total: scored.length,
        query,
        types: types || null,
      };

      // Cache the result
      memorySearchCache.set(threadId, query, result, types);

      logger.info(
        { totalMatches: scored.length, query },
        "[memory-search] Search completed",
      );

      return JSON.stringify(result);
    } catch (error) {
      logger.error({ error, query }, "[memory-search] Search failed");

      return JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Unknown error occurred during memory search",
        query,
      });
    }
  },
  {
    name: "memory_search",
    description:
      "Search through stored memories using keyword queries. Results are ranked by relevance and filtered to the current thread.",
    schema: z.object({
      query: z
        .string()
        .describe("Search query using keywords or phrases (e.g., 'user preferences API')"),
      types: z
        .array(z.enum(["user", "feedback", "project", "reference"]))
        .optional()
        .describe(
          "Optional filter for memory types: user, feedback, project, or reference",
        ),
      limit: z
        .number()
        .optional()
        .default(10)
        .describe("Maximum number of results to return (default: 10, max: 50)"),
      hybrid: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Use hybrid search (keyword + semantic) if available (default: false)",
        ),
    }),
  },
);

/**
 * Invalidate cache entries for a specific thread.
 * Call this after creating/updating/deleting memories in a thread.
 */
export function invalidateThreadCache(threadId: string): void {
  memorySearchCache.invalidate(`^memory:${threadId}:.*`);
}

/**
 * Invalidate cache entries for a specific thread and query pattern.
 * Useful for fine-grained invalidation when you know which queries are affected.
 */
export function invalidateQueryCache(
  threadId: string,
  queryPattern: string
): void {
  memorySearchCache.invalidate(`^memory:${threadId}:${queryPattern}`);
}

/**
 * Clear all memory search cache entries.
 * Useful for testing or when the entire memory store is reset.
 */
export function clearMemorySearchCache(): void {
  memorySearchCache.clear();
}

/**
 * Get memory search cache statistics.
 * Useful for monitoring cache effectiveness.
 */
export function getMemorySearchCacheStats() {
  return memorySearchCache.getStats();
}

