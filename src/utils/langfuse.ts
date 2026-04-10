/**
 * Centralized Langfuse tracing client.
 *
 * Provides Langfuse integration for LLM observability, following best practices:
 * - Session-based tracing for multi-turn conversations
 * - Proper flush handling for script execution
 * - Sensitive data masking
 *
 * @see https://langfuse.com/docs/tracing
 * @see https://langfuse.com/docs/sdk/typescript
 */

import { Langfuse } from "langfuse";

/**
 * Langfuse configuration from environment
 */
interface LangfuseConfig {
  publicKey: string;
  secretKey: string;
  host?: string;
  enabled: boolean;
}

/**
 * Load Langfuse configuration from environment variables
 */
function loadConfig(): LangfuseConfig {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const host = process.env.LANGFUSE_HOST;

  // Auto-disable if keys are not provided
  const enabled = !!(publicKey && secretKey);

  return {
    publicKey: publicKey || "",
    secretKey: secretKey || "",
    host,
    enabled,
  };
}

/**
 * Global Langfuse configuration
 */
const config = loadConfig();

/**
 * Global Langfuse client instance
 *
 * Initialized lazily on first access if credentials are available.
 * Returns a no-op client if credentials are missing.
 */
let _client: Langfuse | null = null;

/**
 * Get or create the Langfuse client instance
 *
 * @returns Langfuse client (or no-op if disabled)
 *
 * @example
 * ```ts
 * import { getLangfuse } from "./utils/langfuse";
 * const langfuse = getLangfuse();
 * await langfuse.flush();
 * ```
 */
export function getLangfuse(): Langfuse {
  if (!config.enabled) {
    // Return no-op client if disabled
    return createNoOpClient();
  }

  if (_client) {
    return _client;
  }

  _client = new Langfuse({
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    ...(config.host && { host: config.host }),
  });

  return _client;
}

/**
 * Check if Langfuse tracing is enabled
 */
export function isLangfuseEnabled(): boolean {
  return config.enabled;
}

/**
 * Create a no-op Langfuse client for when tracing is disabled
 *
 * Implements the Langfuse interface with no-op methods to avoid
 * conditional logic throughout the codebase.
 */
function createNoOpClient(): Langfuse {
  const noop = async () => {};

  return {
    trace: noop,
    span: noop,
    generation: noop,
    score: noop,
    flush: noop,
    flushAsync: noop,
    shutdown: noop,
    shutdownAsync: noop,
    update: noop,
  } as unknown as Langfuse;
}

/**
 * Create a trace with session information
 *
 * @param name - Trace name (use descriptive names like "chat-response", "doc-summary")
 * @param sessionId - Optional session ID for grouping multi-turn conversations
 * @param userId - Optional user ID for user-level attribution
 * @returns Langfuse trace object
 *
 * @example
 * ```ts
 * import { createTrace } from "./utils/langfuse";
 * const trace = createTrace("agent-turn", threadId, userId);
 * ```
 */
export function createTrace(
  name: string,
  sessionId?: string,
  userId?: string,
): ReturnType<Langfuse["trace"]> {
  const langfuse = getLangfuse();
  return langfuse.trace({
    name,
    ...(sessionId && { sessionId }),
    ...(userId && { userId }),
  });
}

/**
 * Flush pending traces to Langfuse
 *
 * Call this before process exit to ensure all traces are sent.
 * Important for script-based invocations where the process
 * terminates immediately after completion.
 *
 * @example
 * ```ts
 * import { flushLangfuse } from "./utils/langfuse";
 * process.on("beforeExit", async () => {
 *   await flushLangfuse();
 * });
 * ```
 */
export async function flushLangfuse(): Promise<void> {
  if (!config.enabled) {
    return;
  }

  const langfuse = getLangfuse();
  await langfuse.flushAsync();
}

/**
 * Shutdown the Langfuse client
 *
 * Call this during graceful shutdown to ensure all data is sent.
 */
export async function shutdownLangfuse(): Promise<void> {
  if (!config.enabled) {
    return;
  }

  const langfuse = getLangfuse();
  await langfuse.shutdownAsync();
}

export default getLangfuse;
