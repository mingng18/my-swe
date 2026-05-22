import { createLogger } from "../logger";
import { recordMetric } from "../telemetry";
import {
  RTK_COMPRESSION_ENABLED,
  RTK_COMPRESS_TOOLS,
  RTK_DEDUP_THRESHOLD,
  RTK_FAILURE_FOCUS_THRESHOLD,
  RTK_MAX_OUTPUT_TOKENS,
  RTK_MIN_COMPRESSION_RATIO,
  RTK_SKIP_TOOLS,
} from "./config";
import {
  applyDeduplication,
  applyFailureFocus,
  extractJsonSchema,
  smartTruncate,
} from "./strategies";
import type {
  CompressedResult,
  CompressionContext,
  CompressionStrategy,
} from "./types";
import { estimateTokens, stripAnsiCodes } from "./utils";

const logger = createLogger("output-compressor");

/**
 * Tool-specific compression strategies.
 */
export const TOOL_STRATEGIES: Record<string, CompressionStrategy[]> = {
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
export const DEFAULT_STRATEGIES: CompressionStrategy[] = [
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
