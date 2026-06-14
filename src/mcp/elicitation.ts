/**
 * MCP Elicitation Support for Bullhorse (#496).
 *
 * When an MCP server needs to ask the user a clarifying question mid
 * tool-flow, it sends an `elicitation/create` request to the client. This
 * module installs a request handler on an MCP client that:
 *
 * 1. Surfaces the question to the active transport via a user-supplied handler.
 * 2. Returns the user's answer to the server in the MCP `ElicitResult` shape.
 * 3. Handles timeout and user-cancellation gracefully — always returning a
 *    well-formed elicitation result and NEVER throwing across the async
 *    boundary.
 *
 * Backward compatibility: this module is opt-in. If
 * {@link installElicitationHandler} is never called, the client advertises no
 * elicitation capability and behaves identically to today. Servers that never
 * elicit are completely unaffected.
 */

import {
  ElicitRequestSchema,
  type ElicitResult as McpElicitResult,
} from "@modelcontextprotocol/sdk/types.js";
import { createLogger } from "../utils/logger.js";
import type {
  ElicitAction,
  ElicitRequest,
  ElicitRequestParams,
  ElicitationHandler,
  McpElicitationOptions,
} from "./types.js";

const logger = createLogger("mcp-elicitation");

/** Default per-elicitation timeout in milliseconds (30s). */
export const DEFAULT_ELICITATION_TIMEOUT_MS = 30000;

/**
 * Normalize the raw MCP `elicitation/create` params (which form a discriminated
 * union over `mode`) into the flat {@link ElicitRequestParams} shape consumed
 * by transports.
 */
export function normalizeElicitParams(
  raw: any,
  serverName: string,
): ElicitRequest {
  const params = (raw && raw.params) || raw || {};
  const mode: "form" | "url" = params.mode === "url" ? "url" : "form";

  return {
    serverName,
    params: {
      message: typeof params.message === "string" ? params.message : "",
      mode,
      requestedSchema:
        mode === "form" && params.requestedSchema
          ? params.requestedSchema
          : undefined,
      url: mode === "url" ? params.url : undefined,
      elicitationId: mode === "url" ? params.elicitationId : undefined,
    },
  };
}

/**
 * Build an MCP `ElicitResult` for the given action/content pair. Used both for
 * the happy path and for the graceful-fallback paths below.
 */
export function buildElicitResult(
  action: ElicitAction,
  content?: Record<string, unknown>,
): McpElicitResult {
  const result: McpElicitResult = { action };
  if (content !== undefined && action === "accept") {
    result.content = content as Record<string, any>;
  }
  return result;
}

/**
 * Resolve the transport-supplied handler into a normalized result.
 *
 * - `undefined`/`null` handler result → decline (no answer given).
 * - thrown error → decline (logged), never re-thrown.
 * - any result missing an `action` → decline.
 */
async function resolveHandlerResult(
  handler: ElicitationHandler,
  request: ElicitRequest,
): Promise<McpElicitResult> {
  let userResult;
  try {
    userResult = await handler(request);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { server: request.serverName, err: errorMsg },
      "[mcp-elicitation] Handler threw; declining",
    );
    return buildElicitResult("decline");
  }

  if (userResult === undefined || userResult === null) {
    return buildElicitResult("decline");
  }

  const action: ElicitAction =
    userResult.action === "accept" ||
    userResult.action === "decline" ||
    userResult.action === "cancel"
      ? userResult.action
      : "decline";

  return buildElicitResult(action, userResult.content);
}

/**
 * Wrap a handler invocation with a timeout. On timeout the elicitation is
 * cancelled (the MCP semantics-correct response for "the user did not respond
 * in time").
 */
async function resolveWithTimeout(
  handler: ElicitationHandler,
  request: ElicitRequest,
  timeoutMs: number,
): Promise<McpElicitResult> {
  if (timeoutMs <= 0) {
    return resolveHandlerResult(handler, request);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<McpElicitResult>((resolve) => {
    timer = setTimeout(() => {
      logger.warn(
        { server: request.serverName, timeoutMs },
        "[mcp-elicitation] Timed out; cancelling",
      );
      resolve(buildElicitResult("cancel"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      resolveHandlerResult(handler, request),
      timeoutPromise,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Install an elicitation request handler on an MCP client.
 *
 * After this call the client must be configured to advertise the elicitation
 * capability (handled by {@link McpClientManager.registerElicitationHandler}).
 * The returned disposer unregisters the handler from the client so the client
 * can be reused cleanly.
 *
 * @param client   The MCP `Client` instance.
 * @param serverName Server name (for logging / surfaced request context).
 * @param options  Handler + optional timeout.
 * @returns A disposer function (no-op-safe).
 */
export function installElicitationHandler(
  client: any,
  serverName: string,
  options: McpElicitationOptions,
): () => void {
  const { handler, timeoutMs = DEFAULT_ELICITATION_TIMEOUT_MS } = options;

  // The MCP client invokes the handler with the raw request (method+params)
  // and an `extra` object. We normalize to a transport-friendly shape and
  // always resolve with a valid ElicitResult — never throwing across the
  // async boundary.
  const wrappedHandler = async (rawRequest: any): Promise<McpElicitResult> => {
    const request = normalizeElicitParams(rawRequest, serverName);
    try {
      return await resolveWithTimeout(handler, request, timeoutMs);
    } catch (err) {
      // Defensive: resolveWithTimeout is written never to throw, but if the
      // SDK ever surfaces an unexpected failure we still must not propagate it.
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(
        { server: serverName, err: errorMsg },
        "[mcp-elicitation] Unexpected failure; declining",
      );
      return buildElicitResult("decline");
    }
  };

  try {
    client.setRequestHandler(ElicitRequestSchema, wrappedHandler);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { server: serverName, err: errorMsg },
      "[mcp-elicitation] Failed to register handler",
    );
    // Non-fatal: client simply won't answer elicitations (server will see a
    // method-not-found error if it tries). Return a no-op disposer.
    return () => {};
  }

  logger.debug(
    { server: serverName, timeoutMs },
    "[mcp-elicitation] Handler installed",
  );

  // The SDK doesn't expose a public unregister, so the disposer is best-effort:
  // overwriting with a handler that always declines restores the no-op default.
  return () => {
    try {
      client.setRequestHandler(ElicitRequestSchema, async () =>
        buildElicitResult("decline"),
      );
    } catch {
      /* ignore — client may already be closed */
    }
  };
}

export type {
  ElicitAction,
  ElicitRequest,
  ElicitRequestParams,
  ElicitResult,
  ElicitationHandler,
  McpElicitationOptions,
} from "./types.js";
