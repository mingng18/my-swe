import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createLogger } from "../utils/logger";
import { MemoryRepository } from "../memory/repository";
import type { MemoryType } from "../memory/types";

const logger = createLogger("memory-search");

// Configuration
const MEMORY_SEARCH_ENABLED = process.env.MEMORY_SEARCH_ENABLED !== "false";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

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
      const repo = new MemoryRepository();

      // Fetch all memories for this thread (with optional type filter)
      const memories = await repo.getByThread(threadId, types);

      if (memories.length === 0) {
        return JSON.stringify({
          matches: [],
          total: 0,
          query,
          message: "No memories found for this thread",
        });
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

      logger.info(
        { totalMatches: scored.length, query },
        "[memory-search] Search completed",
      );

      return JSON.stringify({
        matches: scored,
        total: scored.length,
        query,
        types: types || null,
      });
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
