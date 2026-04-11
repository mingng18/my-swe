import { createLogger } from "../utils/logger";
import { MemoryRepository } from "./repository";
import type { MemorySearchResult, MemorySearchOptions, Memory } from "./types";

const logger = createLogger("search-service");

/**
 * Service for searching memories using semantic and keyword search
 */
export class SearchService {
  constructor(
    private repository: MemoryRepository,
    private embeddingService: {
      generateEmbedding(text: string): Promise<number[]>;
      cosineSimilarity(a: number[], b: number[]): number;
    },
  ) {}

  /**
   * Main search method - uses hybrid search by default
   */
  async search(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    const {
      query,
      hybrid = true,
      similarityThreshold = 0.7,
      threadIds,
    } = options;

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return [];
    }

    if (!threadIds || threadIds.length === 0) {
      logger.warn("No thread IDs provided for search");
      return [];
    }

    // Get all memories for the specified threads
    const allMemories: Memory[] = [];
    for (const threadId of threadIds) {
      const memories = await this.repository.getByThread(
        threadId,
        options.types,
      );
      allMemories.push(...memories);
    }

    if (allMemories.length === 0) {
      return [];
    }

    // Perform search based on type
    let results: MemorySearchResult[];

    if (hybrid) {
      results = await this.hybridSearch(query, allMemories);
    } else {
      // Default to semantic search
      results = await this.semanticSearch(query, allMemories);
    }

    // Filter by similarity threshold
    results = results.filter((r) => r.relevanceScore >= similarityThreshold);

    // Sort by relevance score (descending)
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Apply limit
    const limit = options.limit || 10;
    return results.slice(0, limit);
  }

  /**
   * Hybrid search combining semantic and keyword search
   */
  async hybridSearch(
    query: string,
    memories: Memory[],
  ): Promise<MemorySearchResult[]> {
    // Get semantic results
    const semanticResults = await this.semanticSearch(query, memories);

    // Get keyword results
    const keywordResults = this.keywordSearch(query, memories);

    // Combine and deduplicate results
    const combinedMap = new Map<string, MemorySearchResult>();

    // Add semantic results with weight 0.7
    for (const result of semanticResults) {
      combinedMap.set(result.id, {
        ...result,
        relevanceScore: result.relevanceScore * 0.7,
      });
    }

    // Add keyword results with weight 0.3
    for (const result of keywordResults) {
      const existing = combinedMap.get(result.id);
      if (existing) {
        // Combine scores
        existing.relevanceScore += result.relevanceScore * 0.3;
        // Ensure score doesn't exceed 1.0
        existing.relevanceScore = Math.min(existing.relevanceScore, 1.0);
      } else {
        combinedMap.set(result.id, {
          ...result,
          relevanceScore: result.relevanceScore * 0.3,
        });
      }
    }

    return Array.from(combinedMap.values());
  }

  /**
   * Semantic search using embeddings
   */
  async semanticSearch(
    query: string,
    memories: Memory[],
  ): Promise<MemorySearchResult[]> {
    try {
      // Generate embedding for query
      const queryEmbedding =
        await this.embeddingService.generateEmbedding(query);

      // Calculate similarity for each memory
      const results: MemorySearchResult[] = [];

      for (const memory of memories) {
        // Skip memories without embeddings
        if (!memory.embedding || memory.embedding.length === 0) {
          // Generate embedding on-the-fly if not available
          try {
            const text = `${memory.title}. ${memory.content}`;
            memory.embedding =
              await this.embeddingService.generateEmbedding(text);
            // Save the embedding back to the repository
            await this.repository.update(memory.id!, {
              embedding: memory.embedding,
            });
          } catch (error) {
            logger.warn(
              { memoryId: memory.id },
              "Failed to generate embedding for memory",
            );
            continue;
          }
        }

        const similarity = this.embeddingService.cosineSimilarity(
          queryEmbedding,
          memory.embedding,
        );

        results.push({
          id: memory.id!,
          type: memory.type,
          title: memory.title,
          preview: this.generatePreview(memory.content),
          relevanceScore: similarity,
          createdAt: memory.createdAt || new Date(),
          metadata: memory.metadata,
        });
      }

      return results;
    } catch (error) {
      logger.error({ error }, "Semantic search failed");
      return [];
    }
  }

  /**
   * Keyword search using text matching
   */
  keywordSearch(query: string, memories: Memory[]): MemorySearchResult[] {
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter((t) => t.length > 2);

    if (queryTerms.length === 0) {
      return [];
    }

    const results: MemorySearchResult[] = [];

    for (const memory of memories) {
      const titleLower = memory.title.toLowerCase();
      const contentLower = memory.content.toLowerCase();
      const searchText = `${titleLower} ${contentLower}`;

      // Calculate keyword relevance score
      let score = 0;
      let matchedTerms = 0;

      for (const term of queryTerms) {
        if (titleLower.includes(term)) {
          score += 0.3; // Title matches are weighted higher
          matchedTerms++;
        }
        if (contentLower.includes(term)) {
          score += 0.1;
          matchedTerms++;
        }
      }

      // Normalize score by number of matched terms
      if (matchedTerms > 0) {
        score = score / (queryTerms.length * 0.3); // Normalize to 0-1 range
        score = Math.min(score, 1.0); // Cap at 1.0

        results.push({
          id: memory.id!,
          type: memory.type,
          title: memory.title,
          preview: this.generatePreview(memory.content),
          relevanceScore: score,
          createdAt: memory.createdAt || new Date(),
          metadata: memory.metadata,
        });
      }
    }

    return results;
  }

  /**
   * Generate a short preview of memory content
   */
  private generatePreview(content: string, maxLength: number = 200): string {
    if (content.length <= maxLength) {
      return content;
    }
    return content.substring(0, maxLength) + "...";
  }
}
