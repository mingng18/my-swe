import { createLogger } from "../utils/logger";

const logger = createLogger("tool-wrapper");

/**
 * Standardized error handling wrapper for tools.
 * Catches unhandled exceptions, logs them securely, and returns a clean error string
 * that the LLM agent can understand without crashing the tool execution.
 *
 * @param toolName The name of the tool (for logging)
 * @param fn The tool execution function
 */
export function withErrorHandling<TArgs, TReturn>(
  toolName: string,
  fn: (args: TArgs, config: any) => Promise<TReturn>
): (args: TArgs, config: any) => Promise<TReturn | string> {
  return async (args: TArgs, config: any) => {
    try {
      return await fn(args, config);
    } catch (error: any) {
      logger.error(
        { tool: toolName, error: error.message || error, args },
        `[Tool Execution Error] Unhandled exception in ${toolName}`
      );
      
      // Return a structured error string that the LLM can process
      return JSON.stringify({
        error: `Tool '${toolName}' encountered an unexpected internal error.`,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
