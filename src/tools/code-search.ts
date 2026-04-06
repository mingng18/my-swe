import { tool } from "@langchain/core/tools";
import { z } from "zod";
import path from "path";
import { getSandboxBackendSync } from "../utils/sandboxState";

const MAX_MATCHES = 50;
const MAX_SLICE_LINES = 200;

/**
Search for patterns across the codebase or read a specific line range from a file.

**Search mode** (provide `pattern`):
Runs ripgrep to find matches. Returns structured results with file, line, content,
and optional surrounding context lines. Capped at 50 matches.

**Slice mode** (provide `file_path` + `start_line` + `end_line`):
Reads a specific line range from a file without doing a search.
`end_line` is clamped to `start_line + 200` to prevent context blowout.

All paths are resolved relative to the workspace — the agent can never cause a
"No such file or directory" error by passing absolute paths from another machine.

Args:
    pattern: Regex pattern to search for (search mode)
    path: Directory or file to search in (default: ".", the workspace root)
    file_glob: Restrict search to files matching this glob (e.g. "*.ts")
    case_insensitive: Ignore case when searching (default: false)
    context_lines: Lines of context to include before and after each match (default: 0)
    file_path: Path of file to read (slice mode)
    start_line: First line to read, 1-indexed (slice mode)
    end_line: Last line to read inclusive, 1-indexed (slice mode, clamped to start+200)

Returns:
    Search mode: Array of { file, line, content, context_before, context_after }
    Slice mode:  Array of { line_number, content }
**/
export const codeSearchTool = tool(
  async ({ pattern, path: searchPath, file_glob, case_insensitive, context_lines, file_path, start_line, end_line }, config) => {
    const threadId = config?.configurable?.thread_id;
    if (!threadId)
      return JSON.stringify({ error: "Missing thread_id" });

    const workspaceDir: string = config.configurable?.repo?.workspaceDir ?? "";

    const sandbox = getSandboxBackendSync(threadId);
    if (!sandbox) {
      return JSON.stringify({
        error: "Sandbox backend not initialized. Is USE_SANDBOX=true set?",
      });
    }

    // ---- Slice mode ----
    if (file_path !== undefined && start_line !== undefined && end_line !== undefined) {
      const resolvedFile = path.isAbsolute(file_path)
        ? file_path
        : path.join(workspaceDir, file_path);

      const clampedEnd = Math.min(end_line, start_line + MAX_SLICE_LINES);

      const result = await sandbox.execute(
        `sed -n '${start_line},${clampedEnd}p' '${resolvedFile.replace(/'/g, `'\\''`)}'`,
      );

      if (result.exitCode !== 0) {
        return JSON.stringify({
          error: `Failed to read file slice: ${result.output || "unknown error"}`,
        });
      }

      const lines = result.output.split("\n");
      const output = lines.map((content, idx) => ({
        line_number: start_line + idx,
        content,
      }));
      if (output.length > 0 && output[output.length - 1]?.content === "") {
        output.pop();
      }
      return JSON.stringify(output);
    }

    // ---- Search mode ----
    if (pattern === undefined) {
      return JSON.stringify({
        error:
          "Must provide either `pattern` (search mode) or `file_path` + `start_line` + `end_line` (slice mode).",
      });
    }

    const resolvedSearchPath = searchPath && path.isAbsolute(searchPath)
      ? searchPath
      : path.join(workspaceDir, searchPath ?? ".");

    const flags = [
      "--json",
      "-n",
      case_insensitive ? "--ignore-case" : null,
      context_lines && context_lines > 0 ? `-C ${context_lines}` : null,
      file_glob ? `-g '${file_glob.replace(/'/g, `'\\''`)}'` : null,
    ]
      .filter(Boolean)
      .join(" ");

    const cmd = `rg ${flags} '${pattern.replace(/'/g, `'\\''`)}' '${resolvedSearchPath.replace(/'/g, `'\\''`)}' 2>&1 || true`;

    const result = await sandbox.execute(cmd);

    // Check if rg is missing
    if (
      result.output.includes("command not found") ||
      result.output.includes("rg: not found") ||
      result.output.includes("No such file or directory") && !result.output.includes("matched")
    ) {
      return JSON.stringify({
        error:
          "ripgrep (rg) is not installed in this sandbox. Install it with: apt-get install -y ripgrep",
      });
    }

    // Parse NDJSON from rg --json
    interface SearchResult {
      file: string;
      line: number;
      content: string;
      context_before: string[];
      context_after: string[];
    }

    const results: SearchResult[] = [];
    const pendingContext: Map<string, { result: SearchResult; expectAfter: number }> = new Map();
    let pendingBefore: string[] = [];

    for (const rawLine of result.output.split("\n")) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;

      let msg: any;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        continue;
      }

      if (msg.type === "match") {
        if (results.length >= MAX_MATCHES) break;
        const sr: SearchResult = {
          file: msg.data?.path?.text ?? "",
          line: msg.data?.line_number ?? 0,
          content: (msg.data?.lines?.text ?? "").replace(/\n$/, ""),
          context_before: [...pendingBefore],
          context_after: [],
        };
        results.push(sr);
        pendingBefore = [];
        const key = `${sr.file}:${sr.line}`;
        pendingContext.set(key, { result: sr, expectAfter: context_lines ?? 0 });
      } else if (msg.type === "context") {
        const contextLine = msg.data?.line_number ?? 0;
        const contextContent = (msg.data?.lines?.text ?? "").replace(/\n$/, "");
        let addedToExisting = false;
        for (const entry of pendingContext.values()) {
          if (contextLine > entry.result.line && entry.result.context_after.length < entry.expectAfter) {
            entry.result.context_after.push(contextContent);
            addedToExisting = true;
          }
        }

        if (!addedToExisting) {
           pendingBefore.push(contextContent);
           if (context_lines && pendingBefore.length > context_lines) {
               pendingBefore.shift();
           }
        }
      }
    }

    return JSON.stringify({ matches: results, total: results.length });
  },
  {
    name: "code_search",
    description:
      "Search for patterns across the codebase (ripgrep) or read a specific line range from a file. Paths are resolved relative to the workspace.",
    schema: z.object({
      // Search mode
      pattern: z.string().optional().describe("Regex pattern to search for"),
      path: z
        .string()
        .optional()
        .default(".")
        .describe("Directory or file to search in (default: workspace root)"),
      file_glob: z
        .string()
        .optional()
        .describe("Restrict to files matching this glob, e.g. '*.ts'"),
      case_insensitive: z
        .boolean()
        .optional()
        .default(false)
        .describe("Ignore case when searching"),
      context_lines: z
        .number()
        .optional()
        .default(0)
        .describe("Lines of context before and after each match"),

      // Slice mode
      file_path: z
        .string()
        .optional()
        .describe("Path of file to read (slice mode)"),
      start_line: z
        .number()
        .optional()
        .describe("First line to read, 1-indexed (slice mode)"),
      end_line: z
        .number()
        .optional()
        .describe(
          "Last line to read inclusive, 1-indexed; clamped to start_line + 200 (slice mode)",
        ),
    }),
  },
);
