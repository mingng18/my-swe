/**
 * Tool compression wrapper for RTK-style output compression.
 *
 * This module provides a higher-order function that wraps LangChain tools
 * with automatic output compression. The wrapper:
 * 1. Executes the original tool
 * 2. Applies compression based on tool type
 * 3. Records metrics
 * 4. Returns compressed result
 */

import { tool } from "langchain";
import { compressOutput, type CompressionContext } from "../utils/output-compressor";
import { createLogger } from "../utils/logger";

const logger = createLogger("compression-wrapper");

// Tools that should never be compressed (user-facing actions)
const SKIP_TOOLS = new Set(["github_comment", "merge_pr", "commit_and_open_pr"]);

/**
 * Wrap a tool's function with compression.
 * This creates a new tool function that applies compression to the output.
 */
function wrapToolFunctionWithCompression(
  originalFunc: (args: any, config?: any) => Promise<any>,
  toolName: string,
  getThreadId?: () => string | undefined,
): (args: any, config?: any) => Promise<string> {
  return async function (args: any, config?: any): Promise<string> {
    const startTime = Date.now();
    const threadId = getThreadId?.() || config?.configurable?.thread_id;

    // Execute original tool
    const originalResult = await originalFunc(args, config);

    // Convert result to string for compression
    let resultString: string;
    let exitCode = 0;
    let command: string | undefined;

    if (typeof originalResult === "string") {
      resultString = originalResult;
    } else if (typeof originalResult === "object" && originalResult !== null) {
      const obj = originalResult as Record<string, unknown>;
      exitCode = (obj.exitCode as number) ?? 0;
      command = (args as any).command;
      resultString = JSON.stringify(obj);
    } else {
      resultString = String(originalResult);
    }

    // Apply compression
    const context: CompressionContext = {
      toolName,
      exitCode,
      threadId,
      command,
    };

    const compressed = compressOutput(resultString, context);
    const duration = Date.now() - startTime;

    logger.debug(
      {
        toolName,
        threadId,
        originalSize: compressed.originalSize,
        compressedSize: compressed.compressedSize,
        strategy: compressed.strategy,
        savings: compressed.metadata?.savingsRatio
          ? `${Math.round((compressed.metadata.savingsRatio as number) * 100)}%`
          : "0%",
        duration,
      },
      "[compression-wrapper] Tool executed with compression",
    );

    // Return compressed result
    // If original was an object, try to return compressed version as object
    if (typeof originalResult === "object" && originalResult !== null) {
      try {
        const originalObj = originalResult as Record<string, unknown>;
        return JSON.stringify(
          {
            ...originalObj,
            stdout: compressed.output,
            _compressed: compressed.strategy !== "none",
            _compressionInfo: compressed.metadata,
          },
          null,
          2,
        );
      } catch {
        return compressed.output;
      }
    }

    return compressed.output;
  };
}

/**
 * Wrap a LangChain tool with RTK-style output compression.
 *
 * Creates a new tool with the same schema but with compressed output.
 *
 * @param originalTool - The original LangChain tool to wrap
 * @param getThreadId - Optional function to get the current thread ID
 * @returns A new tool with compression applied
 */
export function wrapToolWithCompression(originalTool: any, getThreadId?: () => string | undefined): any {
  // Skip if tool is in the skip list
  if (SKIP_TOOLS.has(originalTool.name.toLowerCase())) {
    return originalTool;
  }

  logger.debug({ toolName: originalTool.name }, "[compression-wrapper] Wrapping tool");

  // Extract the wrapped function from the original tool
  // LangChain tools store their function internally
  const anyTool = originalTool as any;

  // Create a wrapper around the tool's invocation
  // We need to preserve the schema and other metadata
  const wrappedFunc = wrapToolFunctionWithCompression(
    // The original function is stored differently based on tool type
    anyTool.fields?.func || anyTool.func || anyTool.callable,
    originalTool.name,
    getThreadId,
  );

  // Create a new tool with the wrapped function
  return tool(wrappedFunc, {
    name: originalTool.name,
    description: originalTool.description,
    schema: anyTool.fields?.schema || anyTool.schema,
  });
}

/**
 * Wrap multiple tools with compression.
 *
 * @param tools - Array of tools to wrap
 * @param getThreadId - Optional function to get the current thread ID
 * @returns Array of wrapped tools
 */
export function wrapToolsWithCompression(tools: any[], getThreadId?: () => string | undefined): any[] {
  return tools.map((t) => wrapToolWithCompression(t, getThreadId));
}

/**
 * Create a tool wrapper that can be applied at runtime.
 *
 * This is useful for scenarios where you need to wrap tools
 * dynamically based on runtime conditions.
 *
 * @param getThreadId - Optional function to get the current thread ID
 * @returns A function that wraps tools
 */
export function createToolWrapper(getThreadId?: () => string | undefined) {
  return function (tool: any): any {
    return wrapToolWithCompression(tool, getThreadId);
  };
}
