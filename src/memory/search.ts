import { createLogger } from "../utils/logger";
import { MemoryRepository } from "./repository";
import { escapeRegex } from "../utils/regex";
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
      generateEmbeddingsBatch?(texts: string[]): Promise<number[][]>;
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
    let allMemories: Memory[] = await this.repository.getByThreads(
      threadIds,
      options.types,
    );

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
      // Find memories that need embeddings
      const memoriesToUpdate = memories.filter(
        (m) => !m.embedding || m.embedding.length === 0,
      );

      // Generate missing embeddings in parallel
      const updateMemoriesPromise = (async () => {
        if (memoriesToUpdate.length > 0) {
          try {
            if (this.embeddingService.generateEmbeddingsBatch) {
              const texts = memoriesToUpdate.map(
                (m) => `${m.title}. ${m.content}`,
              );
              const embeddings =
                await this.embeddingService.generateEmbeddingsBatch(texts);

              await Promise.all(
                memoriesToUpdate.map(async (memory, index) => {
                  memory.embedding = embeddings[index];
                  try {
                    await this.repository.update(memory.id!, {
                      embedding: memory.embedding,
                    });
                  } catch (error) {
                    logger.warn(
                      { memoryId: memory.id, error },
                      "Failed to save generated embedding to repository",
                    );
                  }
                }),
              );
            } else {
              await Promise.all(
                memoriesToUpdate.map(async (memory) => {
                  try {
                    const text = `${memory.title}. ${memory.content}`;
                    memory.embedding =
                      await this.embeddingService.generateEmbedding(text);
                    await this.repository.update(memory.id!, {
                      embedding: memory.embedding,
                    });
                  } catch (error) {
                    logger.warn(
                      { memoryId: memory.id, error },
                      "Failed to generate embedding for memory",
                    );
                  }
                }),
              );
            }
          } catch (error) {
            logger.error({ error }, "Failed to batch generate embeddings");
          }
        }
      })();

      // Start fetching query embedding
      const queryEmbeddingPromise =
        this.embeddingService.generateEmbedding(query);

      // Wait for both concurrent operations
      const [queryEmbedding] = await Promise.all([
        queryEmbeddingPromise,
        updateMemoriesPromise,
      ]);

      // Calculate similarity for each memory
      const results: MemorySearchResult[] = [];

      for (const memory of memories) {
        // Skip if still no embedding (e.g., generation failed)
        if (!memory.embedding || memory.embedding.length === 0) continue;

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

    // ⚡ Bolt Optimization: Use a single compiled regex to find all matching terms at once
    // instead of scanning the full string multiple times with string.includes()
    const escapedTerms = queryTerms.map(escapeRegex);
    const termRegex = new RegExp(escapedTerms.join("|"), "g");

    for (const memory of memories) {
      const titleLower = memory.title.toLowerCase();
      const contentLower = memory.content.toLowerCase();

      // Calculate keyword relevance score
      let score = 0;
      let matchedTerms = 0;

      termRegex.lastIndex = 0;
      const titleMatches = new Set<string>();
      let match;
      while ((match = termRegex.exec(titleLower)) !== null) {
        titleMatches.add(match[0]);
        if (titleMatches.size === queryTerms.length) break;
      }

      termRegex.lastIndex = 0;
      const contentMatches = new Set<string>();
      while ((match = termRegex.exec(contentLower)) !== null) {
        contentMatches.add(match[0]);
        if (contentMatches.size === queryTerms.length) break;
      }

      for (let i = 0; i < queryTerms.length; i++) {
        const term = queryTerms[i];
        if (titleMatches.has(term)) {
          score += 0.3; // Title matches are weighted higher
          matchedTerms++;
        }
        if (contentMatches.has(term)) {
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
