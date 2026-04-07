import { tool } from "@langchain/core/tools";
import { z } from "zod";
import path from "path";
import { getSandboxBackendSync } from "../utils/sandboxState";
import { createLogger } from "../utils/logger";

const logger = createLogger("semantic-search");

// Configuration
const SEMANTIC_SEARCH_ENABLED = process.env.SEMANTIC_SEARCH_ENABLED !== "false";
const SEMANTIC_SEARCH_INDEX_PATH =
  process.env.SEMANTIC_SEARCH_INDEX_PATH || ".semantic-index";
const MAX_RESULTS = 20;
const CHUNK_SIZE = 500; // characters per chunk

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

    const files = result.output.split("\n").filter(Boolean);
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
          // Read first 100 lines of file for scoring
          const readResult = await sandbox.execute(
            `head -n 100 '${file.replace(/'/g, `'\\''`)}' 2>/dev/null || true`,
          );

          if (readResult.output) {
            const lines = readResult.output.split("\n");
            let bestScore = 0;
            let bestLine = 1;
            let bestContent = "";

            // Score each line/chunk
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              if (!line.trim()) continue;

              const lineTerms = extractTerms(line);
              const score = cosineSimilarity(queryTerms, lineTerms);

              if (score > bestScore) {
                bestScore = score;
                bestLine = i + 1;
                bestContent = line.trim();
              }
            }

            // Also score combined first 10 lines for context
            const contextLines = lines.slice(0, 10).join(" ");
            const contextTerms = extractTerms(contextLines);
            const contextScore = cosineSimilarity(queryTerms, contextTerms);

            if (contextScore > bestScore) {
              bestScore = contextScore;
              bestLine = 1;
              bestContent = lines.slice(0, 3).join("\n").trim();
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
