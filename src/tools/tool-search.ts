import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createLogger } from "../utils/logger";
import type { StructuredTool } from "@langchain/core/tools";

const logger = createLogger("tool-search");

/**
 * Tool search tool for discovering available tools by keyword or name.
 *
 * This tool helps agents find tools based on natural language queries
 * when they need to perform a specific action but aren't sure which
 * tool to use.
 *
 * Usage:
 * - "select:activate_skill" - Get exact tool by name
 * - "github pr" - Search for tools related to GitHub and PRs
 * - "+slack send" - Require "slack" in name, rank by remaining terms
 */
export const toolSearchTool = tool(
  async ({ query, max_results = 5 }, config) => {
    // Get tools from config - they're passed by the agent harness
    // @ts-ignore - tools are passed via configurable
    const tools: StructuredTool[] = config?.configurable?.tools || [];

    logger.debug(
      { query, maxResults: max_results, toolCount: tools.length },
      "[tool-search] Searching tools",
    );

    // Check for select: prefix - direct tool selection
    const selectMatch = query.match(/^select:(.+)$/i);
    if (selectMatch) {
      const requested = selectMatch[1]!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const found: string[] = [];
      const missing: string[] = [];

      for (const toolName of requested) {
        const tool = tools.find(
          (t) => t.name.toLowerCase() === toolName.toLowerCase(),
        );
        if (tool) {
          if (!found.includes(tool.name)) {
            found.push(tool.name);
          }
        } else {
          missing.push(toolName);
        }
      }

      if (found.length === 0) {
        return `No tools found matching: ${missing.join(", ")}`;
      }

      // Return detailed info for found tools
      const results = found
        .map((name) => {
          const t = tools.find((tool) => tool.name === name);
          if (!t) return "";
          return formatToolInfo(t);
        })
        .join("\n\n---\n\n");

      if (missing.length > 0) {
        return `${results}\n\n[WARNING] Not found: ${missing.join(", ")}`;
      }
      return results;
    }

    // Keyword search
    const matches = searchToolsByKeywords(query, tools, max_results);

    logger.debug(
      { query, matchCount: matches.length },
      "[tool-search] Search completed",
    );

    if (matches.length === 0) {
      const allToolNames = tools
        .map((t) => t.name)
        .sort()
        .join(", ");
      return `No tools found matching "${query}".\n\nAvailable tools: ${allToolNames}`;
    }

    const results = matches.map((t) => formatToolInfo(t)).join("\n\n---\n\n");

    return matches.length === max_results && tools.length > max_results
      ? `${results}\n\n[Showing top ${max_results} of ${tools.length} tools]`
      : results;
  },
  {
    name: "tool_search",
    description:
      "Search for available tools by keywords or exact name. Use this when you need to find a tool for a specific task but aren't sure which one exists. " +
      "Supports direct selection with 'select:tool_name' or keyword search like 'github pr' or 'file read'. " +
      "Use '+term' for required terms (e.g., '+slack send' requires 'slack' in the tool name).",
    schema: z.object({
      query: z
        .string()
        .describe(
          "Search query. Use 'select:tool_name' for exact match, or keywords to search. Prefix with + for required terms.",
        ),
      max_results: z
        .number()
        .optional()
        .default(5)
        .describe("Maximum number of results to return (default: 5)"),
    }),
  },
);

/**
 * Format tool information for display.
 */
function formatToolInfo(tool: any): string {
  const parts: string[] = [];
  parts.push(`**Tool:** ${tool.name}`);

  if (tool.description) {
    parts.push(`\n${tool.description}`);
  }

  // Try to extract schema information
  if (tool.schema?._def?.typeName() === "ZodObject") {
    const zodObj = tool.schema;
    try {
      const shape = zodObj.shape;
      if (shape && typeof shape === "object") {
        const params = Object.entries(shape).map(
          ([key, value]: [string, any]) => {
            const description = value._def?.description || "";
            const typeName = value._def?.typeName?.() || "any";
            return `  - ${key}${description ? `: ${description}` : ""} (${typeName})`;
          },
        );
        if (params.length > 0) {
          parts.push("\n**Parameters:**");
          parts.push(params.join("\n"));
        }
      }
    } catch (e) {
      // Schema parsing failed, skip
    }
  }

  return parts.join("\n");
}

/**
 * Parse tool name into searchable parts.
 * Handles both camelCase and snake_case.
 */
function parseToolName(name: string): { parts: string[]; full: string } {
  // Convert camelCase to lowercase parts
  const camelParts = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  return {
    parts: camelParts,
    full: camelParts.join(" "),
  };
}

/**
 * Compile word-boundary regexes for search terms.
 */
function compileTermPatterns(terms: string[]): Map<string, RegExp> {
  const patterns = new Map<string, RegExp>();
  for (const term of terms) {
    if (!patterns.has(term)) {
      patterns.set(term, new RegExp(`\\b${escapeRegExp(term)}\\b`, "i"));
    }
  }
  return patterns;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Keyword-based search over tool names and descriptions.
 * Handles both camelCase and snake_case tool names.
 */
function searchToolsByKeywords(
  query: string,
  tools: any[],
  maxResults: number,
): any[] {
  const queryLower = query.toLowerCase().trim();

  // Fast path: exact match by tool name
  const exactMatch = tools.find((t) => t.name.toLowerCase() === queryLower);
  if (exactMatch) {
    return [exactMatch];
  }

  const queryTerms = queryLower.split(/\s+/).filter((t) => t.length > 0);

  // Partition into required (+prefixed) and optional terms
  const requiredTerms: string[] = [];
  const optionalTerms: string[] = [];
  for (const term of queryTerms) {
    if (term.startsWith("+") && term.length > 1) {
      requiredTerms.push(term.slice(1));
    } else {
      optionalTerms.push(term);
    }
  }

  const allScoringTerms =
    requiredTerms.length > 0
      ? [...requiredTerms, ...optionalTerms]
      : queryTerms;
  const termPatterns = compileTermPatterns(allScoringTerms);

  // Pre-filter to tools matching ALL required terms
  let candidateTools = tools;
  if (requiredTerms.length > 0) {
    candidateTools = tools.filter((tool) => {
      const parsed = parseToolName(tool.name);
      const descLower = (tool.description || "").toLowerCase();

      return requiredTerms.every((term) => {
        const pattern = termPatterns.get(term)!;
        return (
          parsed.parts.includes(term) ||
          parsed.parts.some((p) => p.includes(term)) ||
          pattern.test(descLower)
        );
      });
    });
  }

  // Score remaining tools
  const scored = candidateTools.map((tool) => {
    const parsed = parseToolName(tool.name);
    const descLower = (tool.description || "").toLowerCase();

    let score = 0;
    for (const term of allScoringTerms) {
      const pattern = termPatterns.get(term)!;

      // Exact part match (highest weight)
      if (parsed.parts.includes(term)) {
        score += 10;
      } else if (parsed.parts.some((p) => p.includes(term))) {
        score += 5;
      }

      // Full name fallback
      if (parsed.full.includes(term) && score === 0) {
        score += 3;
      }

      // Description match
      if (pattern.test(descLower)) {
        score += 2;
      }
    }

    return { tool, score };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((item) => item.tool);
}
