/**
 * Retry Utility with Exponential Backoff and Jitter
 *
 * Implements exponential backoff with full jitter to handle rate limiting
 * and transient failures gracefully. This prevents thundering herd problems
 * and provides configurable retry behavior.
 *
 * Algorithm:
 * - delay = min(initialDelay * (base ^ attempt), maxDelay)
 * - jitteredDelay = random(0, delay)
 *
 * References:
 * - https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 * - https://cloud.google.com/iot/docs/how-tos/exponential-backoff
 */

/**
 * Configuration for retry behavior.
 */
export interface RetryConfig {
  /** Initial delay in milliseconds before first retry */
  initialDelayMs: number;

  /** Maximum delay in milliseconds (cap for exponential backoff) */
  maxDelayMs: number;

  /** Base multiplier for exponential backoff (typically 2) */
  backoffBase: number;

  /** Maximum number of retry attempts (0 = no retries) */
  maxRetries: number;
}

/**
 * Result of a retry operation.
 */
export interface RetryResult<T> {
  /** Whether the operation succeeded */
  success: boolean;

  /** The result value if successful */
  value?: T;

  /** The error if failed */
  error?: Error;

  /** Number of attempts made */
  attempts: number;

  /** Total duration in milliseconds */
  totalDurationMs: number;
}

/**
 * Retry attempt information for observability.
 */
export interface RetryAttempt {
  /** Attempt number (0-indexed) */
  attemptNumber: number;

  /** Whether this attempt succeeded */
  success: boolean;

  /** Delay before this attempt in milliseconds */
  delayMs: number;

  /** Error if this attempt failed */
  error?: Error;

  /** Timestamp of this attempt */
  timestamp: Date;
}

/**
 * Default retry configuration.
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  backoffBase: 2,
  maxRetries: 3,
};

/**
 * Load retry configuration from environment variables.
 *
 * Reads TELEGRAM_BACKOFF_* environment variables to customize retry behavior.
 */
export function loadRetryConfig(): RetryConfig {
  return {
    initialDelayMs: parseInt(
      process.env.TELEGRAM_BACKOFF_INITIAL_MS || "1000",
      10,
    ),
    maxDelayMs: parseInt(process.env.TELEGRAM_BACKOFF_MAX_MS || "60000", 10),
    backoffBase: parseFloat(process.env.TELEGRAM_BACKOFF_BASE || "2"),
    maxRetries: parseInt(
      process.env.TELEGRAM_BACKOFF_MAX_RETRIES || "3",
      10,
    ),
  };
}

/**
 * Calculate exponential backoff delay with full jitter.
 *
 * Formula: delay = random(0, min(initialDelay * (base ^ attempt), maxDelay))
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param config - Retry configuration
 * @returns Delay in milliseconds
 */
export function calculateBackoff(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): number {
  // Calculate exponential delay: initialDelay * (base ^ attempt)
  const exponentialDelay = config.initialDelayMs * Math.pow(config.backoffBase, attempt);

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  // Apply full jitter: random value between 0 and cappedDelay
  return Math.floor(Math.random() * cappedDelay);
}

/**
 * Sleep for specified milliseconds.
 *
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the delay
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic and exponential backoff.
 *
 * @param fn - Function to execute (receives attempt number)
 * @param config - Retry configuration (optional, uses env vars or defaults)
 * @param onRetry - Optional callback called before each retry (receives attempt info)
 * @returns Promise<RetryResult<T>> with operation result
 *
 * @example
 * ```ts
 * const result = await retryWithBackoff(
 *   async (attempt) => {
 *     const response = await fetch(url);
 *     if (!response.ok) throw new Error(`HTTP ${response.status}`);
 *     return await response.json();
 *   },
 *   { maxRetries: 5, initialDelayMs: 1000 }
 * );
 * ```
 */
export async function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  config?: Partial<RetryConfig>,
  onRetry?: (attempt: RetryAttempt) => void,
): Promise<RetryResult<T>> {
  const fullConfig: RetryConfig = {
    ...loadRetryConfig(),
    ...config,
  };

  const attempts: RetryAttempt[] = [];
  const startTime = Date.now();
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
    const attemptStartTime = Date.now();
    const delayBeforeAttempt =
      attempt > 0 ? calculateBackoff(attempt - 1, fullConfig) : 0;

    // Sleep before retry (not before first attempt)
    if (delayBeforeAttempt > 0) {
      await sleep(delayBeforeAttempt);
    }

    try {
      const value = await fn(attempt);
      const durationMs = Date.now() - attemptStartTime;

      // Record successful attempt
      attempts.push({
        attemptNumber: attempt,
        success: true,
        delayMs: delayBeforeAttempt,
        timestamp: new Date(),
      });

      return {
        success: true,
        value,
        attempts: attempt + 1,
        totalDurationMs: Date.now() - startTime,
      };
    } catch (error) {
      const durationMs = Date.now() - attemptStartTime;
      const errorObj =
        error instanceof Error ? error : new Error(String(error));

      // Record failed attempt
      const attemptInfo: RetryAttempt = {
        attemptNumber: attempt,
        success: false,
        delayMs: delayBeforeAttempt,
        error: errorObj,
        timestamp: new Date(),
      };
      attempts.push(attemptInfo);
      lastError = errorObj;

      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(attemptInfo);
      }

      // If this was the last attempt, we're done
      if (attempt >= fullConfig.maxRetries) {
        break;
      }
    }
  }

  // All retries exhausted
  return {
    success: false,
    error: lastError,
    attempts: attempts.length,
    totalDurationMs: Date.now() - startTime,
  };
}

/**
 * Create a retry function with pre-configured settings.
 *
 * Useful for creating reusable retry functions for specific operations.
 *
 * @param config - Retry configuration
 * @param onRetry - Optional retry callback
 * @returns A function that executes operations with the configured retry behavior
 *
 * @example
 * ```ts
 * const fetchWithRetry = createRetryFn({ maxRetries: 5 });
 * const result = await fetchWithRetry(async () => fetch(url));
 * ```
 */
export function createRetryFn<T>(
  config?: Partial<RetryConfig>,
  onRetry?: (attempt: RetryAttempt) => void,
): (fn: (attempt: number) => Promise<T>) => Promise<RetryResult<T>> {
  return (fn: (attempt: number) => Promise<T>) =>
    retryWithBackoff(fn, config, onRetry);
}

/**
 * Format retry attempts for logging.
 *
 * @param attempts - Array of retry attempts
 * @returns Formatted string for logging
 */
export function formatRetryAttempts(attempts: RetryAttempt[]): string {
  if (attempts.length === 0) {
    return "No attempts made";
  }

  const lines: string[] = [`Retry attempts: ${attempts.length}`];

  for (const attempt of attempts) {
    const status = attempt.success ? "✓" : "✗";
    const delay = attempt.delayMs > 0 ? ` (delay: ${attempt.delayMs}ms)` : "";
    const error = attempt.error ? ` - ${attempt.error.message}` : "";
    lines.push(
      `  ${status} Attempt ${attempt.attemptNumber + 1}: ${status === "✓" ? "success" : "failed"}${delay}${error}`,
    );
  }

  return lines.join("\n");
}
