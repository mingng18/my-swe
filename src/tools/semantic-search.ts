import { tool } from "@langchain/core/tools";
import { z } from "zod";
import path from "path";
import { getSandboxBackendSync } from "../utils/sandboxState";
import { createLogger } from "../utils/logger";
import { GenericCache } from "../utils/cache/lru-cache";

const logger = createLogger("semantic-search");

// Configuration
const SEMANTIC_SEARCH_ENABLED = process.env.SEMANTIC_SEARCH_ENABLED !== "false";
const SEMANTIC_SEARCH_INDEX_PATH =
  process.env.SEMANTIC_SEARCH_INDEX_PATH || ".semantic-index";
const MAX_RESULTS = 20;
const CHUNK_SIZE = 500; // characters per chunk

// Cache configuration
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CACHE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

/**
 * Cached document vector to avoid re-extracting terms.
 */
interface CachedDocumentVector {
  filePath: string;
  line: number;
  chunk: string;
  terms: string[]; // Array of terms for serialization
}

/**
 * Semantic search cache with LRU eviction.
 *
 * Caches document vectors (extracted terms from files) to avoid
 * re-reading and re-processing files on subsequent searches.
 */
class SemanticSearchCache {
  private cache: GenericCache;

  constructor() {
    this.cache = new GenericCache({
      maxSize: MAX_CACHE_SIZE_BYTES,
      ttl: CACHE_TTL_MS,
      debug: "semantic-search-cache",
    });
  }

  /**
   * Get cached document vectors for a file.
   */
  getDocumentVectors(filePath: string): CachedDocumentVector[] | null {
    return this.cache.get<CachedDocumentVector[]>(`doc:${filePath}`);
  }

  /**
   * Cache document vectors for a file.
   */
  setDocumentVectors(filePath: string, vectors: CachedDocumentVector[]): void {
    this.cache.set(`doc:${filePath}`, vectors);
  }

  /**
   * Get cached file listing for a path.
   */
  getFileListing(searchPath: string, fileGlob: string | undefined): string[] | null {
    return this.cache.get<string[]>("files", { path: searchPath, glob: fileGlob ?? "" });
  }

  /**
   * Cache file listing for a path.
   */
  setFileListing(searchPath: string, fileGlob: string | undefined, files: string[]): void {
    this.cache.set("files", files, { path: searchPath, glob: fileGlob ?? "" });
  }

  /**
   * Invalidate cache entries for a specific file.
   * Call this when a file is modified.
   */
  invalidateFile(filePath: string): void {
    this.cache.delete(`doc:${filePath}`);
  }

  /**
   * Invalidate cache entries for a directory.
   * Call this when files in a directory are modified.
   */
  invalidateDirectory(dirPath: string): void {
    this.cache.invalidate(`doc:${dirPath}.*`);
    this.cache.invalidate(`files.*path=${dirPath}`);
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
}

// Global cache instance
export const semanticSearchCache = new SemanticSearchCache();

/**
 * Simple term frequency vector for semantic-like search.
 * This provides better results than pure regex without requiring embeddings.
 */
interface DocumentVector {
  filePath: string;
  line: number;
  chunk: string;
  terms: Map<string, number>;
}

/**
 * Extract meaningful terms from text.
 * Removes common stopwords and splits on word boundaries.
 */
export function extractTerms(text: string): Set<string> {
  const commonWords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "as",
    "is",
    "was",
    "are",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "should",
    "could",
    "may",
    "might",
    "must",
    "can",
    "this",
    "that",
    "these",
    "those",
    "it",
    "its",
    "return",
    "function",
    "const",
    "let",
    "var",
    "if",
    "else",
    "then",
    "when",
    "new",
    "import",
    "export",
    "default",
    "class",
    "interface",
    "type",
    "async",
    "await",
    "try",
    "catch",
    "throw",
  ]);

  const terms = new Set<string>();

  // Split on non-word characters and convert to lowercase
  const words = text.toLowerCase().split(/[^a-z0-9_]+/);

  for (const word of words) {
    if (word.length >= 3 && !commonWords.has(word)) {
      terms.add(word);
    }
  }

  return terms;
}

/**
 * Calculate cosine similarity between two term sets.
 */
export function cosineSimilarity(
  terms1: Set<string>,
  terms2: Set<string>,
): number {
  if (terms1.size === 0 || terms2.size === 0) {
    return 0;
  }

  // Calculate intersection
  let intersection = 0;
  for (const term of terms1) {
    if (terms2.has(term)) {
      intersection++;
    }
  }

  // Cosine similarity: |A ∩ B| / sqrt(|A| * |B|)
  const denominator = Math.sqrt(terms1.size * terms2.size);
  return denominator > 0 ? intersection / denominator : 0;
}

/**
 * Search for files that match a conceptual query.
 *
 * This tool uses term frequency analysis to find files that are semantically
 * related to your query, rather than just matching literal patterns.
 *
 * **Best for:**
 * - Finding files related to a concept (e.g., "authentication", "database")
 * - Discovering where features are implemented
 * - Exploring unfamiliar codebases
 *
 * **Not for:**
 * - Finding exact function/class names (use code_search instead)
 * - Pattern matching with regex (use code_search instead)

 * Args:
    query: Conceptual search query (e.g., "user authentication flow")
    path: Directory to search in (default: workspace root)
    file_glob: Restrict to files matching this glob (e.g., "*.ts")
    max_results: Maximum number of results to return (default: 20)

Returns:
    Array of results with file path, line number, snippet, and relevance score.
**/
export const semanticSearchTool = tool(
  async ({ query, path: searchPath, file_glob, max_results }, config) => {
    const threadId = config?.configurable?.thread_id;
    if (!threadId) {
      return JSON.stringify({ error: "Missing thread_id" });
    }

    if (!SEMANTIC_SEARCH_ENABLED) {
      return JSON.stringify({
        error:
          "Semantic search is disabled. Set SEMANTIC_SEARCH_ENABLED=true to enable.",
      });
    }

    const workspaceDir: string = config.configurable?.repo?.workspaceDir ?? "";
    const sandbox = getSandboxBackendSync(threadId);
    if (!sandbox) {
      return JSON.stringify({
        error: "Sandbox backend not initialized. Is USE_SANDBOX=true set?",
      });
    }

    // Extract terms from query
    const queryTerms = extractTerms(query);
    if (queryTerms.size === 0) {
      return JSON.stringify({
        error:
          "Query too short or contains only common words. Please provide a more specific query.",
      });
    }

    logger.info(
      { query, termCount: queryTerms.size, terms: Array.from(queryTerms) },
      "[semantic-search] Searching with query terms",
    );

    const resolvedSearchPath =
      searchPath && path.isAbsolute(searchPath)
        ? searchPath
        : path.join(workspaceDir, searchPath ?? ".");

    // Check cache for file listing
    let files = semanticSearchCache.getFileListing(resolvedSearchPath, file_glob);
    if (files !== null) {
      logger.debug("[semantic-search] Cache hit for file listing");
    } else {
      logger.debug("[semantic-search] Cache miss for file listing");
      // Find files using ripgrep
      const globFlag = file_glob
        ? `-g '${file_glob.replace(/'/g, `'\\''`)}'`
        : "";
      const cmd = `rg --files-with-matches ${globFlag} '${resolvedSearchPath.replace(/'/g, `'\\''`)}' 2>/dev/null || true`;

      let result;
      try {
        result = await sandbox.execute(cmd);
      } catch (error) {
        return JSON.stringify({
          error: `Error finding files: ${error instanceof Error ? error.message : String(error)}`,
        });
      }

      if (result.exitCode !== 0 && !result.output) {
        return JSON.stringify({
          error: "Failed to find files in the specified path",
        });
      }

      files = result.output.split("\n").filter(Boolean);

      // Cache the file listing
      if (files.length > 0) {
        semanticSearchCache.setFileListing(resolvedSearchPath, file_glob, files);
      }
    }

    if (files.length === 0) {
      return JSON.stringify({
        matches: [],
        total: 0,
        query,
        message: "No files found matching the search criteria",
      });
    }

    // Score each file by reading and comparing with query
    const results: Array<{
      file: string;
      line: number;
      content: string;
      score: number;
    }> = [];

    // Process files in batches to avoid overwhelming the sandbox
    const batchSize = 10;
    const maxFilesToProcess = Math.min(files.length, 50); // Limit total files processed

    for (let i = 0; i < maxFilesToProcess; i += batchSize) {
      const batch = files.slice(i, i + batchSize);

      for (const file of batch) {
        try {
          // Check cache for document vectors
          let cachedVectors = semanticSearchCache.getDocumentVectors(file);
          let vectors: CachedDocumentVector[];

          if (cachedVectors !== null) {
            logger.debug(`[semantic-search] Cache hit for document: ${file}`);
            vectors = cachedVectors;
          } else {
            logger.debug(`[semantic-search] Cache miss for document: ${file}`);
            // Read first 100 lines of file for scoring
            const readResult = await sandbox.execute(
              `head -n 100 '${file.replace(/'/g, `'\\''`)}' 2>/dev/null || true`,
            );

            if (!readResult.output) {
              continue;
            }

            const lines = readResult.output.split("\n");
            vectors = [];

            // Extract terms from each line and cache them
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              if (!line.trim()) continue;

              const lineTerms = extractTerms(line);
              vectors.push({
                filePath: file,
                line: i + 1,
                chunk: line.trim(),
                terms: Array.from(lineTerms),
              });
            }

            // Also cache the combined first 10 lines for context
            const contextLines = lines.slice(0, 10).join(" ");
            const contextTerms = extractTerms(contextLines);
            vectors.push({
              filePath: file,
              line: 1,
              chunk: lines.slice(0, 3).join("\n").trim(),
              terms: Array.from(contextTerms),
            });

            // Cache the vectors
            semanticSearchCache.setDocumentVectors(file, vectors);
          }

          // Score each cached vector against the query
          let bestScore = 0;
          let bestLine = 1;
          let bestContent = "";

          for (const vector of vectors) {
            const vectorTerms = new Set(vector.terms);
            const score = cosineSimilarity(queryTerms, vectorTerms);

            if (score > bestScore) {
              bestScore = score;
              bestLine = vector.line;
              bestContent = vector.chunk;
            }
          }

          if (bestScore > 0.1) {
            // Only include results with some relevance
            results.push({
              file: path.relative(workspaceDir, file),
              line: bestLine,
              content: bestContent.substring(0, 200),
              score: bestScore,
            });
          }
        } catch (err) {
          // Skip files that can't be read
          continue;
        }
      }
    }

    // Sort by score and limit results
    results.sort((a, b) => b.score - a.score);
    const limitedResults = results.slice(0, max_results || MAX_RESULTS);

    return JSON.stringify({
      matches: limitedResults,
      total: limitedResults.length,
      query,
      queryTerms: Array.from(queryTerms),
    });
  },
  {
    name: "semantic_search",
    description:
      "Search for files by conceptual meaning rather than exact patterns. Best for discovering where features are implemented or exploring unfamiliar codebases.",
    schema: z.object({
      query: z
        .string()
        .describe(
          "Conceptual search query (e.g., 'user authentication flow', 'database connection')",
        ),
      path: z
        .string()
        .optional()
        .default(".")
        .describe("Directory to search in (default: workspace root)"),
      file_glob: z
        .string()
        .optional()
        .describe("Restrict to files matching this glob, e.g. '*.ts'"),
      max_results: z
        .number()
        .optional()
        .default(20)
        .describe("Maximum number of results to return"),
    }),
  },
);
