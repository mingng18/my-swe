import { createLogger } from "../logger";
import { isValidPattern } from "./utils";
import { retrieveArtifact } from "./storage";
import type { QueryOptions, QueryResult } from "./types";

const logger = createLogger("memory-pointer");

/**
 * Query a specific portion of an artifact.
 * Useful for reading line ranges or searching within large artifacts.
 *
 * @param pointerId - The pointer ID to query
 * @param threadId - Thread ID for validation
 * @param options - Query options (line-range, grep, etc.)
 * @returns Query result with content
 */
export async function queryArtifact(
  pointerId: string,
  threadId: string,
  options: QueryOptions,
): Promise<QueryResult | null> {
  const artifact = await retrieveArtifact(pointerId, threadId);
  if (!artifact) {
    return null;
  }

  const { content } = artifact;
  const originalSize = content.length;

  switch (options.type) {
    case "full": {
      // Return full content (use with caution)
      return {
        content,
        truncated: false,
        originalSize,
        queryType: "full",
      };
    }

    case "line-range": {
      // Extract specific line range
      const start = options.startLine ?? 1;
      const end = options.endLine ?? start + 100;

      const lines = content.split("\n");
      const selectedLines = lines.slice(start - 1, end);

      return {
        content: selectedLines.join("\n"),
        truncated: end < lines.length,
        originalSize,
        queryType: "line-range",
      };
    }

    case "grep": {
      // Search for pattern within artifact
      const pattern = options.pattern;
      if (!pattern) {
        return null;
      }

      // Validate pattern to prevent ReDoS
      if (!isValidPattern(pattern)) {
        logger.warn(
          { pattern },
          "[memory-pointer] Invalid or unsafe regex pattern",
        );
        return null;
      }

      const flags = options.caseInsensitive ? "gi" : "g";
      const regex = new RegExp(pattern, flags);

      const lines = content.split("\n");
      const matches: string[] = [];
      const maxResults = options.maxResults ?? 50;

      for (const line of lines) {
        if (regex.test(line)) {
          matches.push(line);
          if (matches.length >= maxResults) {
            break;
          }
        }
      }

      return {
        content: matches.join("\n"),
        truncated: matches.length >= maxResults,
        originalSize,
        queryType: "grep",
      };
    }

    case "summary": {
      // Return a summary (first N lines, last N lines)
      const lines = content.split("\n");
      const headerLines = 20;
      const trailerLines = 10;

      let summary: string;
      if (lines.length <= headerLines + trailerLines) {
        summary = content;
      } else {
        const header = lines.slice(0, headerLines).join("\n");
        const trailer = lines.slice(-trailerLines).join("\n");
        const omitted = lines.length - headerLines - trailerLines;
        summary = `${header}\n\n... (${omitted} lines omitted) ...\n\n${trailer}`;
      }

      return {
        content: summary,
        truncated: true,
        originalSize,
        queryType: "summary",
      };
    }

    default:
      return null;
  }
}
