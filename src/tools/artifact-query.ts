import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  queryArtifact,
  listArtifacts,
  deleteArtifact,
  retrieveArtifact,
  type QueryOptions,
  type ArtifactMetadata,
} from "../utils/memory-pointer";

/**
Query a stored artifact by pointer ID.

When a tool returns a MEMORY POINTER, it means the response was too large
to include directly in context. Use this tool to retrieve specific portions:

**Query types:**
- `summary`: Returns first 20 lines + last 10 lines with omission indicator
- `line-range`: Extracts specific lines (start_line to end_line, max 500 lines)
- `grep`: Searches for a pattern within the artifact (max 50 matches)

**Example flow:**
1. Another tool returns: `[MEMORY POINTER: ptr_abc123]`
2. First call with type="summary" to understand structure
3. Then call with type="line-range" for specific sections you need
4. Or use type="grep" to find specific patterns

Args:
    pointer_id: The pointer ID (e.g., "ptr_abc123")
    type: Query type - "summary", "line-range", or "grep"
    start_line: First line to read (1-indexed, for line-range type)
    end_line: Last line to read inclusive (for line-range type)
    pattern: Regex pattern to search for (for grep type)
    case_insensitive: Ignore case when searching (for grep type, default false)

Returns:
    Content from the artifact with metadata about original size and truncation.
**/
export const artifactQueryTool = tool(
  async (
    { pointer_id, type, start_line, end_line, pattern, case_insensitive },
    config,
  ) => {
    const threadId = config?.configurable?.thread_id;
    if (!threadId) {
      return JSON.stringify({
        error: "Missing thread_id",
      });
    }

    // Validate pointer_id format
    if (!pointer_id || !pointer_id.startsWith("ptr_")) {
      return JSON.stringify({
        error:
          "Invalid pointer_id format. Must start with 'ptr_' (e.g., 'ptr_abc123')",
      });
    }

    // Build query options
    const queryOptions: QueryOptions = {
      type: type as "summary" | "line-range" | "grep" | "full",
    };

    if (type === "line-range") {
      if (start_line === undefined || end_line === undefined) {
        return JSON.stringify({
          error:
            "line-range type requires start_line and end_line parameters",
        });
      }
      // Clamp range to 500 lines max to prevent context overflow
      const maxLines = 500;
      const clampedEnd = Math.min(end_line, start_line + maxLines);
      queryOptions.startLine = start_line;
      queryOptions.endLine = clampedEnd;

      if (clampedEnd < end_line) {
        return JSON.stringify({
          warning: `Line range clamped to ${maxLines} lines (requested ${start_line}-${end_line}, returning ${start_line}-${clampedEnd})`,
          note: "Make multiple calls with different ranges if needed",
        });
      }
    }

    if (type === "grep") {
      if (!pattern) {
        return JSON.stringify({
          error: "grep type requires a pattern parameter",
        });
      }
      queryOptions.pattern = pattern;
      queryOptions.caseInsensitive = case_insensitive ?? false;
      queryOptions.maxResults = 50;
    }

    // Query the artifact
    const result = await queryArtifact(pointer_id, threadId, queryOptions);

    if (!result) {
      return JSON.stringify({
        error:
          "Artifact not found, expired, or access denied. The pointer may have been cleaned up.",
        hint:
          "Artifacts expire after 24 hours. If you still need this data, please re-run the original tool.",
      });
    }

    return JSON.stringify({
      pointer_id,
      content: result.content,
      truncated: result.truncated,
      original_size: result.originalSize,
      original_size_formatted: `${result.originalSize} characters`,
      query_type: result.queryType,
      note: result.truncated
        ? "Result was truncated. Use line-range or summary to see other sections."
        : undefined,
    });
  },
  {
    name: "artifact_query",
    description:
      "Query a stored artifact (memory pointer) to retrieve specific portions. Use when a tool returns a MEMORY POINTER reference.",
    schema: z.object({
      pointer_id: z
        .string()
        .describe("The pointer ID (e.g., 'ptr_abc123')"),
      type: z
        .enum(["summary", "line-range", "grep"])
        .describe("Query type: summary (overview), line-range (specific lines), or grep (pattern search)"),
      start_line: z
        .number()
        .optional()
        .describe("First line to read (1-indexed, required for line-range)"),
      end_line: z
        .number()
        .optional()
        .describe("Last line to read inclusive (required for line-range, max 500 lines)"),
      pattern: z
        .string()
        .optional()
        .describe("Regex pattern to search for (required for grep)"),
      case_insensitive: z
        .boolean()
        .optional()
        .default(false)
        .describe("Ignore case when searching (for grep)"),
    }),
  },
);

/**
List all memory pointer artifacts for the current thread.

Use this to see what artifacts are available from previous tool calls in
this session. Artifacts are stored when tool responses are too large to
include directly in context.

Args:
    (none)

Returns:
    Array of artifact metadata including ID, type, timestamp, and size.
**/
export const artifactListTool = tool(async (_args, config) => {
  const threadId = config?.configurable?.thread_id;
  if (!threadId) {
    return JSON.stringify({
      error: "Missing thread_id",
    });
  }

  const artifacts = await listArtifacts(threadId);

  return JSON.stringify({
    thread_id: threadId,
    count: artifacts.length,
    artifacts: artifacts.map((a) => ({
      id: a.id,
      type: a.type,
      timestamp: new Date(a.timestamp).toISOString(),
      size: a.size,
      size_formatted: `${a.size} characters`,
      expires_at: new Date(a.expiresAt).toISOString(),
      metadata: a.metadata,
    })),
  });
}, {
  name: "artifact_list",
  description: "List all memory pointer artifacts for the current thread.",
  schema: z.object({}),
});

/**
Delete a specific artifact by pointer ID.

Use this to clean up artifacts you no longer need. Note that artifacts
automatically expire after 24 hours.

Args:
    pointer_id: The pointer ID to delete

Returns:
    Confirmation of deletion.
**/
export const artifactDeleteTool = tool(async ({ pointer_id }, config) => {
  const threadId = config?.configurable?.thread_id;
  if (!threadId) {
    return JSON.stringify({
      error: "Missing thread_id",
    });
  }

  // First verify the artifact belongs to this thread
  const artifact = await retrieveArtifact(pointer_id, threadId);
  if (!artifact) {
    return JSON.stringify({
      error: "Artifact not found or access denied",
    });
  }

  await deleteArtifact(pointer_id);

  return JSON.stringify({
    success: true,
    pointer_id,
    message: "Artifact deleted successfully",
  });
}, {
  name: "artifact_delete",
  description: "Delete a specific artifact by pointer ID.",
  schema: z.object({
    pointer_id: z.string().describe("The pointer ID to delete"),
  }),
});
