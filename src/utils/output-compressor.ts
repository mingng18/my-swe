/**
 * RTK (Rust Token Killer) style output compression for LangChain tools.
 *
 * This module implements intelligent compression strategies to dramatically
 * reduce token usage from tool outputs while preserving critical information.
 *
 * Core strategies:
 * 1. Failure Focus - Only show failures, hide passing tests
 * 2. Deduplication - Group repeating log lines
 * 3. JSON Schema Extraction - Show structure only, not full payloads
 * 4. ANSI Stripping - Remove terminal formatting noise
 * 5. Smart Truncation - Keep start and end of output
 */

import { createLogger } from "./logger";
import { recordMetric } from "./telemetry";

const logger = createLogger("output-compressor");

// Configuration from environment
const RTK_COMPRESSION_ENABLED = process.env.RTK_COMPRESSION_ENABLED !== "false";
const RTK_MAX_OUTPUT_TOKENS = Number.parseInt(
  process.env.RTK_MAX_OUTPUT_TOKENS || "2000",
  10,
);
const RTK_MIN_COMPRESSION_RATIO = Number.parseFloat(
  process.env.RTK_MIN_COMPRESSION_RATIO || "0.5",
);
const RTK_FAILURE_FOCUS_THRESHOLD = Number.parseInt(
  process.env.RTK_FAILURE_FOCUS_THRESHOLD || "10",
  10,
);
const RTK_DEDUP_THRESHOLD = Number.parseInt(
  process.env.RTK_DEDUP_THRESHOLD || "3",
  10,
);
const RTK_TRUNCATE_HEAD_TOKENS = Number.parseInt(
  process.env.RTK_TRUNCATE_HEAD_TOKENS || "500",
  10,
);
const RTK_TRUNCATE_TAIL_TOKENS = Number.parseInt(
  process.env.RTK_TRUNCATE_TAIL_TOKENS || "500",
  10,
);

// Tools that should never be compressed (user-facing actions)
const RTK_SKIP_TOOLS = new Set([
  "github_comment",
  "merge_pr",
  "commit_and_open_pr",
  "sandbox_pause",
  "sandbox_resume",
  "sandbox_network",
]);

// Tools that should always use compression
const RTK_COMPRESS_TOOLS = new Set([
  "sandbox_shell",
  "code_search",
  "semantic_search",
  "internet_search",
  "fetch_url",
]);

/**
 * Compression context passed to compression functions.
 */
export interface CompressionContext {
  toolName: string;
  exitCode?: number;
  threadId?: string;
  command?: string;
}

/**
 * Result of compression operation.
 */
export interface CompressedResult {
  output: string;
  originalSize: number;
  compressedSize: number;
  strategy: string;
  metadata?: Record<string, unknown>;
}

/**
 * Estimate token count for a string (rough approximation).
 * Uses ~4 characters per token for English text.
 */
function estimateTokens(str: string): number {
  return Math.ceil(str.length / 4);
}

/**
 * Strip ANSI escape codes from terminal output.
 * Removes colors, cursor movements, and other terminal formatting.
 */
export function stripAnsiCodes(input: string): string {
  // Remove ANSI escape sequences
  const ansiEscape = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
  let cleaned = input.replace(ansiEscape, "");

  // Remove carriage returns used for progress bars
  cleaned = cleaned.replace(/\r+\n/g, "\n");
  cleaned = cleaned.replace(/\r(?!\n)/g, "");

  return cleaned;
}

/**
 * Apply failure focus compression to test/build output.
 * Only shows failures and summary, hides passing items.
 */
export function applyFailureFocus(input: string, command?: string): string {
  const lines = input.split("\n");

  // Detect test framework based on command patterns
  const isJest = command?.includes("jest") || command?.includes("npm test");
  const isPytest =
    command?.includes("pytest") || command?.includes("python -m pytest");
  const isGoTest = command?.includes("go test");
  const isCargo = command?.includes("cargo") || command?.includes("rustc");
  const isMaven = command?.includes("mvn") || command?.includes("maven");
  const isGradle = command?.includes("gradle");

  // Count pass/fail patterns
  let passCount = 0;
  let failCount = 0;
  const failures: string[] = [];
  const errors: string[] = [];

  for (const line of lines) {
    // Jest patterns
    if (isJest) {
      if (/^[\s●]*✓|PASS/.test(line)) passCount++;
      if (/^[\s●]*✗|FAIL/.test(line)) {
        failCount++;
        failures.push(line);
      }
    }
    // pytest patterns
    else if (isPytest) {
      if (/PASSED/.test(line)) passCount++;
      if (/FAILED/.test(line)) {
        failCount++;
        failures.push(line);
      }
    }
    // Go test patterns
    else if (isGoTest) {
      if (/--- PASS:/.test(line)) passCount++;
      if (/--- FAIL:/.test(line)) {
        failCount++;
        failures.push(line);
      }
    }
    // Cargo patterns
    else if (isCargo) {
      if (/Compiling|Finished|Checking/.test(line)) passCount++;
      if (/error\[E|warning:/.test(line)) {
        errors.push(line);
      }
    }
    // Maven patterns
    else if (isMaven) {
      if (/Tests run:.*Failures: 0.*Errors: 0/.test(line)) passCount++;
      if (/Tests run:.*(Failures: [1-9]|Errors: [1-9])/.test(line)) {
        failCount++;
        failures.push(line);
      }
    }
    // Gradle patterns
    else if (isGradle) {
      if (/BUILD SUCCESSFUL/.test(line)) passCount++;
      if (/BUILD FAILED|FAILED/.test(line)) {
        failCount++;
        failures.push(line);
      }
    }
    // Generic patterns
    else {
      if (/\[OK\]|\[PASS\]|passed/.test(line.toLowerCase())) passCount++;
      if (/\[FAIL\]|\[ERROR\]|failed|error:/i.test(line)) {
        if (/error:/i.test(line)) {
          errors.push(line);
        } else {
          failures.push(line);
        }
      }
    }
  }

  // If we have enough passing items to hide, apply failure focus
  if (passCount >= RTK_FAILURE_FOCUS_THRESHOLD) {
    const result: string[] = [];

    if (failCount === 0 && errors.length === 0) {
      return `Status: Success (${passCount} checks passed)`;
    }

    if (passCount > 0) {
      result.push(`Passed: ${passCount}`);
    }

    if (failCount > 0) {
      result.push(`Failed: ${failCount}`);
      // Include first few failures with context
      const contextLines: string[] = [];
      let inFailure = false;
      for (const line of lines) {
        if (/FAIL|error|Error|Exception/.test(line)) {
          inFailure = true;
        }
        if (inFailure) {
          contextLines.push(line);
          if (contextLines.length > 50) break; // Limit context per failure
        }
      }
      result.push(...failures.slice(0, 10));
      if (contextLines.length > 0) {
        result.push("\nFailure details:");
        result.push(...contextLines.slice(0, 20));
      }
    }

    if (errors.length > 0) {
      result.push(`\nErrors: ${errors.length}`);
      result.push(...errors.slice(0, 10));
    }

    return result.join("\n");
  }

  // Not enough to apply failure focus, return original
  return input;
}

/**
 * Deduplicate repeating log lines.
 * Groups identical lines (ignoring timestamps) and shows counts.
 */
export function applyDeduplication(input: string): string {
  const lines = input.split("\n");
  const counts = new Map<string, number>();

  // Timestamp regex patterns
  const timestampPatterns = [
    /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/, // ISO 8601
    /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}/, // US date
    /^\d{2}:\d{2}:\d{2}/, // Time only
    /^\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/, // Syslog format
  ];

  for (const line of lines) {
    let normalized = line.trim();
    if (!normalized) continue;

    // Strip timestamps
    for (const pattern of timestampPatterns) {
      normalized = normalized.replace(pattern, "").trim();
    }

    const key = normalized.substring(0, 200); // Limit key length
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  // Build deduplicated output
  const result: string[] = [];
  const sorted = Array.from(counts.entries())
    .filter(([_, count]) => count >= RTK_DEDUP_THRESHOLD)
    .sort((a, b) => b[1] - a[1]);

  // Show repeated lines with counts
  for (const [line, count] of sorted.slice(0, 20)) {
    if (count > RTK_DEDUP_THRESHOLD) {
      result.push(`[x${count}] ${line}`);
    } else {
      result.push(line);
    }
  }

  // Add lines that didn't repeat enough
  for (const [line, count] of sorted) {
    if (count < RTK_DEDUP_THRESHOLD) {
      result.push(line);
    }
  }

  return result.length > 0 ? result.join("\n") : input;
}

/**
 * Extract JSON schema from a JSON string.
 * Shows structure and types instead of full values.
 */
export function extractJsonSchema(input: string): string {
  try {
    const parsed = JSON.parse(input);

    function extractType(value: unknown, depth = 0, maxDepth = 3): string {
      if (depth > maxDepth) return "...";

      if (value === null) return "null";
      if (typeof value === "boolean") return "boolean";
      if (typeof value === "number") return "number";
      if (typeof value === "string") {
        // Truncate long strings
        return value.length > 50
          ? `string(${value.length} chars)`
          : `"${value}"`;
      }
      if (Array.isArray(value)) {
        if (value.length === 0) return "[]";
        const elemType = extractType(value[0], depth + 1, maxDepth);
        return `Array[${value.length}] of ${elemType}`;
      }
      if (typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>);
        if (entries.length === 0) return "{}";
        const fields = entries.slice(0, 10).map(([k, v]) => {
          const t = extractType(v, depth + 1, maxDepth);
          return `"${k}": ${t}`;
        });
        if (entries.length > 10) {
          fields.push(`... (${entries.length - 10} more fields)`);
        }
        return `{ ${fields.join(", ")} }`;
      }
      return "unknown";
    }

    const schema = extractType(parsed);
    return JSON.stringify({ schema, itemCount: 1 }, null, 2);
  } catch {
    // Not valid JSON, return original
    return input;
  }
}

/**
 * Smart truncation that keeps the start and end of output.
 * Errors usually appear at the end, so we preserve both ends.
 */
export function smartTruncate(input: string, maxTokens: number): string {
  const estimated = estimateTokens(input);

  if (estimated <= maxTokens) {
    return input;
  }

  // Calculate character limits (rough approximation)
  const headChars = RTK_TRUNCATE_HEAD_TOKENS * 4;
  const tailChars = RTK_TRUNCATE_TAIL_TOKENS * 4;

  if (input.length <= headChars + tailChars + 100) {
    return input;
  }

  const head = input.substring(0, headChars);
  const tail = input.substring(input.length - tailChars);

  const omitted = input.length - headChars - tailChars;
  return `${head}\n\n... [ ${omitted.toLocaleString()} characters truncated to save tokens ] ...\n\n${tail}`;
}

/**
 * Compression strategy interface.
 */
interface CompressionStrategy {
  name: string;
  apply: (input: string, context: CompressionContext) => string;
  priority: number;
}

/**
 * Tool-specific compression strategies.
 */
const TOOL_STRATEGIES: Record<string, CompressionStrategy[]> = {
  sandbox_shell: [
    {
      name: "failure_focus",
      apply: (input, ctx) => applyFailureFocus(input, ctx.command),
      priority: 10,
    },
    {
      name: "deduplication",
      apply: applyDeduplication,
      priority: 5,
    },
    {
      name: "ansi_strip",
      apply: stripAnsiCodes,
      priority: 1,
    },
  ],
  code_search: [
    {
      name: "json_schema",
      apply: (input) => {
        try {
          const parsed = JSON.parse(input);
          // For code search, keep file, line, and snippet (truncated)
          if (Array.isArray(parsed)) {
            const truncated = parsed.slice(0, 20).map((r: any) => ({
              file: r.file,
              line: r.line,
              content:
                r.content?.substring(0, 100) +
                (r.content?.length > 100 ? "..." : ""),
            }));
            return JSON.stringify(truncated, null, 2);
          }
        } catch {}
        return input;
      },
      priority: 10,
    },
  ],
  semantic_search: [
    {
      name: "truncate",
      apply: (input) => smartTruncate(input, 1000),
      priority: 10,
    },
  ],
  fetch_url: [
    {
      name: "json_schema",
      apply: (input) => {
        if (input.trim().startsWith("{")) {
          return extractJsonSchema(input);
        }
        return input;
      },
      priority: 10,
    },
  ],
};

/**
 * Default compression strategy for unknown tools.
 */
const DEFAULT_STRATEGIES: CompressionStrategy[] = [
  {
    name: "ansi_strip",
    apply: stripAnsiCodes,
    priority: 1,
  },
  {
    name: "truncate",
    apply: (input) => smartTruncate(input, RTK_MAX_OUTPUT_TOKENS),
    priority: 10,
  },
];

/**
 * Main compression function.
 * Applies RTK strategies based on tool type and output characteristics.
 */
export function compressOutput(
  output: string,
  context: CompressionContext,
): CompressedResult {
  const originalSize = estimateTokens(output);

  // Skip if compression is disabled
  if (!RTK_COMPRESSION_ENABLED) {
    return {
      output,
      originalSize,
      compressedSize: originalSize,
      strategy: "none",
    };
  }

  // Skip for whitelisted tools
  if (RTK_SKIP_TOOLS.has(context.toolName)) {
    return {
      output,
      originalSize,
      compressedSize: originalSize,
      strategy: "skipped",
    };
  }

  let compressed = output;
  let appliedStrategy = "none";

  // Get strategies for this tool
  const strategies = TOOL_STRATEGIES[context.toolName] || DEFAULT_STRATEGIES;

  // Sort by priority and apply
  strategies.sort((a, b) => b.priority - a.priority);

  for (const strategy of strategies) {
    const before = compressed;
    compressed = strategy.apply(compressed, context);

    if (compressed !== before) {
      appliedStrategy = strategy.name;
    }
  }

  const compressedSize = estimateTokens(compressed);
  const savingsRatio = 1 - compressedSize / originalSize;

  // Only use compression if we achieved minimum savings
  if (
    savingsRatio < RTK_MIN_COMPRESSION_RATIO &&
    originalSize < RTK_MAX_OUTPUT_TOKENS
  ) {
    return {
      output,
      originalSize,
      compressedSize: originalSize,
      strategy: "none",
    };
  }

  // Record metrics
  if (context.threadId) {
    recordMetric("compression.original_tokens", originalSize, {
      tool: context.toolName,
      threadId: context.threadId,
      strategy: appliedStrategy,
    });

    recordMetric("compression.compressed_tokens", compressedSize, {
      tool: context.toolName,
      threadId: context.threadId,
      strategy: appliedStrategy,
    });

    recordMetric("compression.savings_ratio", Math.round(savingsRatio * 100), {
      tool: context.toolName,
      threadId: context.threadId,
      strategy: appliedStrategy,
    });
  }

  logger.debug(
    {
      tool: context.toolName,
      original: originalSize,
      compressed: compressedSize,
      savings: `${Math.round(savingsRatio * 100)}%`,
      strategy: appliedStrategy,
    },
    "[output-compressor] Compressed output",
  );

  return {
    output: compressed,
    originalSize,
    compressedSize,
    strategy: appliedStrategy,
    metadata: {
      savingsRatio: Math.round(savingsRatio * 100) / 100,
      originalTokens: originalSize,
      compressedTokens: compressedSize,
    },
  };
}

/**
 * Check if a tool should have its output compressed.
 */
export function shouldCompressTool(toolName: string): boolean {
  if (!RTK_COMPRESSION_ENABLED) return false;
  if (RTK_SKIP_TOOLS.has(toolName)) return false;
  return RTK_COMPRESS_TOOLS.has(toolName);
}

/**
 * Get compression configuration.
 */
export function getCompressionConfig(): {
  enabled: boolean;
  maxOutputTokens: number;
  minCompressionRatio: number;
  failureFocusThreshold: number;
  dedupThreshold: number;
  skipTools: string[];
  compressTools: string[];
} {
  return {
    enabled: RTK_COMPRESSION_ENABLED,
    maxOutputTokens: RTK_MAX_OUTPUT_TOKENS,
    minCompressionRatio: RTK_MIN_COMPRESSION_RATIO,
    failureFocusThreshold: RTK_FAILURE_FOCUS_THRESHOLD,
    dedupThreshold: RTK_DEDUP_THRESHOLD,
    skipTools: Array.from(RTK_SKIP_TOOLS),
    compressTools: Array.from(RTK_COMPRESS_TOOLS),
  };
}
