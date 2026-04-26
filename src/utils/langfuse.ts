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
 * Patterns for detecting sensitive data that should be masked in traces.
 */
const SENSITIVE_PATTERNS = [
  // Bearer tokens (common in Authorization headers)
  /Bearer\s+[A-Za-z0-9\-._~+/]+/gi,
  // OpenAI-style API keys (sk- prefix)
  /sk-[A-Za-z0-9]{32,}/g,
  // Langfuse public keys (pk- prefix)
  /pk-[A-Za-z0-9]{32,}/g,
  // Generic api_key patterns
  /api[_-]?key["']?\s*[:=]\s*["']?[A-Za-z0-9]{20,}/gi,
  // Generic token patterns
  /token["']?\s*[:=]\s*["']?[A-Za-z0-9]{20,}/gi,
  // Password fields
  /password["']?\s*[:=]\s*["']?[^\s"']{8,}/gi,
];

/**
 * Mask sensitive data from text before sending to Langfuse.
 *
 * Replaces detected sensitive patterns with "***REDACTED***" to prevent
 * API keys, tokens, and passwords from being logged in observability systems.
 *
 * @param text - The text to sanitize
 * @returns Sanitized text with sensitive data masked
 *
 * @example
 * ```ts
 * const input = "Authorization: Bearer sk-123456...";
 * const masked = maskSensitiveData(input);
 * // Returns: "Authorization: Bearer ***REDACTED***"
 * ```
 */
export function maskSensitiveData(text: string): string {
  if (!text) {
    return text;
  }

  let masked = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    masked = masked.replace(pattern, "***REDACTED***");
  }
  return masked;
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
