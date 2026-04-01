/**
 * Tool error handling middleware.
 *
 * Wraps all tool calls in try/except so that unhandled exceptions are
 * returned as error ToolMessages instead of crashing the agent run.
 */

import { createLogger } from "../utils/logger";

const logger = createLogger("tool-error-handler");

/**
 * Tool call request interface
 */
export interface ToolCallRequest {
  tool_call?: ToolCall | Record<string, unknown>;
  tool_name?: string;
  name?: string;
  args?: Record<string, unknown>;
  id?: string;
}

/**
 * Tool call interface (as used in tool_call)
 */
export interface ToolCall {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
}

/**
 * Command type for LangGraph
 */
export type Command = Record<string, unknown>;

/**
 * Tool message interface
 */
export interface ToolMessage {
  content: string;
  tool_call_id?: string;
  status?: string;
  name?: string;
}

/**
 * Error payload structure
 */
export interface ErrorPayload {
  error: string;
  error_type: string;
  status: string;
  name?: string;
}

/**
 * Get the name from a candidate object.
 */
function getName(candidate: unknown): string | null {
  if (!candidate) {
    return null;
  }
  if (typeof candidate === "string") {
    return candidate;
  }
  if (typeof candidate === "object" && candidate !== null) {
    if ("name" in candidate && typeof candidate.name === "string") {
      return candidate.name;
    }
  }
  return null;
}

/**
 * Extract the tool name from a tool call request.
 */
function extractToolName(request: ToolCallRequest | null): string | null {
  if (!request) {
    return null;
  }

  const attrs = ["tool_call", "tool_name", "name"] as const;

  for (const attr of attrs) {
    const value = request[attr];
    const name = getName(value);
    if (name) {
      return name;
    }
  }

  return null;
}

/**
 * Convert an exception to an error payload.
 */
function toErrorPayload(
  error: Error,
  request: ToolCallRequest | null = null,
): ErrorPayload {
  const data: ErrorPayload = {
    error: String(error),
    error_type: error.constructor.name,
    status: "error",
  };

  const toolName = extractToolName(request);
  if (toolName) {
    data.name = toolName;
  }

  return data;
}

/**
 * Get the tool call ID from a request.
 */
function getToolCallId(request: ToolCallRequest): string | undefined {
  if (
    request.tool_call &&
    typeof request.tool_call === "object" &&
    "id" in request.tool_call
  ) {
    return String(request.tool_call.id);
  }
  return request.id;
}

/**
 * Synchronous tool call wrapper that catches and converts errors.
 */
export function wrapToolCall(
  request: ToolCallRequest,
  handler: () => ToolMessage | Command,
): ToolMessage | Command {
  try {
    return handler();
  } catch (error) {
    logger.error({ error, request }, "Error during tool call handling");
    const data = toErrorPayload(
      error instanceof Error ? error : new Error(String(error)),
      request,
    );
    return {
      content: JSON.stringify(data),
      tool_call_id: getToolCallId(request),
      status: "error",
    };
  }
}

/**
 * Asynchronous tool call wrapper that catches and converts errors.
 */
export async function awrapToolCall(
  request: ToolCallRequest,
  handler: () => Promise<ToolMessage | Command>,
): Promise<ToolMessage | Command> {
  try {
    return await handler();
  } catch (error) {
    logger.error({ error, request }, "Error during tool call handling");
    const data = toErrorPayload(
      error instanceof Error ? error : new Error(String(error)),
      request,
    );
    return {
      content: JSON.stringify(data),
      tool_call_id: getToolCallId(request),
      status: "error",
    };
  }
}

/**
 * Higher-order function that wraps a tool function with error handling.
 *
 * Usage:
 * ```ts
 * const safeTool = withToolErrorHandling(myToolFunction);
 * ```
 */
export function withToolErrorHandling<
  TRequest extends ToolCallRequest,
  TResult extends ToolMessage | Command,
>(
  toolFn: (request: TRequest) => TResult | Promise<TResult>,
): (request: TRequest) => TResult | Promise<TResult> {
  return async (request: TRequest): Promise<TResult> => {
    try {
      const result = await toolFn(request);
      return result;
    } catch (error) {
      logger.error({ error, request }, "Error during tool call handling");
      const data = toErrorPayload(
        error instanceof Error ? error : new Error(String(error)),
        request,
      );
      return {
        content: JSON.stringify(data),
        tool_call_id: getToolCallId(request),
        status: "error",
      } as TResult;
    }
  };
}

/**
 * Create a tool error handler class for use with LangGraph middleware.
 */
export class ToolErrorMiddleware {
  /**
   * Normalize tool execution errors into predictable payloads.
   *
   * Catches any exception thrown during a tool call and converts it into
   * a ToolMessage with status="error" so the LLM can see the failure and
   * self-correct, rather than crashing the entire agent run.
   */

  /**
   * Wrap a synchronous tool call with error handling.
   */
  wrapToolCall(
    request: ToolCallRequest,
    handler: () => ToolMessage | Command,
  ): ToolMessage | Command {
    return wrapToolCall(request, handler);
  }

  /**
   * Wrap an asynchronous tool call with error handling.
   */
  async awrapToolCall(
    request: ToolCallRequest,
    handler: () => Promise<ToolMessage | Command>,
  ): Promise<ToolMessage | Command> {
    return awrapToolCall(request, handler);
  }
}
