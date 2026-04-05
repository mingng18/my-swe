/**
 * Bounded Retry Loop
 *
 * Implements the Stripe Minions retry pattern:
 * - Agentic nodes: max 2 retries before escalating to human
 * - Verification nodes: retry on failure with loop detection
 * - Deterministic nodes: no retry (fail fast)
 *
 * Key principles:
 * 1. Never retry indefinitely - always have a max retry limit
 * 2. Escalate to human when retries are exhausted
 * 3. Track retry count per node for observability
 *
 * NOTE: This module is kept for reference and future use.
 * The current implementation uses existing DeepAgents middleware for retry logic.
 *
 * References:
 * - https://github.com/stripe/minions
 * - Internal enterprise transformation plan (Phase 1, section 1.4)
 */

/**
 * Node execution type for retry configuration.
 */
export enum NodeType {
  DETERMINISTIC = "deterministic",
  AGENTIC = "agentic",
  VERIFICATION = "verification",
}

/**
 * Result of a node execution attempt.
 */
export interface NodeResult {
  success: boolean;
  state: Record<string, unknown>;
  shouldRetry?: boolean;
  error?: string;
}

/**
 * Retry configuration for a node execution.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;

  /** Delay between retries in milliseconds (exponential backoff) */
  initialDelayMs: number;

  /** Backoff multiplier */
  backoffFactor: number;

  /** Whether to escalate to human on failure */
  escalateOnFailure: boolean;
}

/**
 * Default retry configurations by node type.
 */
export const DEFAULT_RETRY_CONFIGS: Record<NodeType, RetryConfig> = {
  deterministic: {
    maxRetries: 0, // No retry - fail fast
    initialDelayMs: 0,
    backoffFactor: 1,
    escalateOnFailure: false,
  },
  agentic: {
    maxRetries: 2, // Stripe Minions pattern: max 2 retries
    initialDelayMs: 1000,
    backoffFactor: 2,
    escalateOnFailure: true,
  },
  verification: {
    maxRetries: 1, // One retry for transient failures
    initialDelayMs: 500,
    backoffFactor: 1.5,
    escalateOnFailure: false,
  },
};

/**
 * Retry attempt information.
 */
export interface RetryAttempt {
  attemptNumber: number;
  success: boolean;
  error?: string;
  durationMs: number;
  timestamp: Date;
}

/**
 * Retry result with full history.
 */
export interface RetryResult {
  finalResult: NodeResult;
  attempts: RetryAttempt[];
  escalated: boolean;
  escalationReason?: string;
}

/**
 * Escalation handler type.
 *
 * Called when max retries are exceeded and escalation is enabled.
 * Should notify a human operator and pause execution.
 */
export type EscalationHandler = (
  nodeId: string,
  attempts: RetryAttempt[],
  lastError: string,
) => Promise<void>;

/**
 * Bounded retry loop executor.
 *
 * Executes nodes with retry logic according to the node type:
 * - Deterministic: Execute once, fail immediately on error
 * - Agentic: Execute up to maxRetries times, escalate on failure
 * - Verification: Execute up to maxRetries times, return pass/fail
 */
export class BoundedRetryLoop {
  private configs: Map<NodeType, RetryConfig>;
  private escalationHandler?: EscalationHandler;

  constructor(
    options: {
      configs?: Partial<Record<NodeType, Partial<RetryConfig>>>;
      escalationHandler?: EscalationHandler;
    } = {},
  ) {
    // Merge user configs with defaults
    this.configs = new Map();
    for (const [type, defaultConfig] of Object.entries(DEFAULT_RETRY_CONFIGS)) {
      const userConfig = options.configs?.[type as NodeType];
      this.configs.set(type as NodeType, {
        ...defaultConfig,
        ...userConfig,
      });
    }
    this.escalationHandler = options.escalationHandler;
  }

  /**
   * Execute a node function with retry logic.
   *
   * @param nodeId - Node identifier for tracking
   * @param nodeType - Type of node (deterministic, agentic, verification)
   * @param executeFn - Function to execute (receives attempt number)
   * @param state - Current agent state (optional, not used in current implementation)
   * @returns Promise<RetryResult> with final result and attempt history
   */
  async execute(
    nodeId: string,
    nodeType: NodeType,
    executeFn: (attempt: number) => Promise<NodeResult>,
    state?: Record<string, unknown>,
  ): Promise<RetryResult> {
    const config =
      this.configs.get(nodeType) ?? DEFAULT_RETRY_CONFIGS[nodeType];
    const attempts: RetryAttempt[] = [];
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      const startTime = Date.now();
      const timestamp = new Date();

      try {
        const result = await executeFn(attempt);
        const durationMs = Date.now() - startTime;

        attempts.push({
          attemptNumber: attempt,
          success: result.success,
          error: result.error,
          durationMs,
          timestamp,
        });

        // If successful or should not retry, return
        if (result.success || !result.shouldRetry) {
          return {
            finalResult: result,
            attempts,
            escalated: false,
          };
        }

        // If this was the last attempt, we're done
        if (attempt >= config.maxRetries) {
          lastError = result.error || "Max retries exceeded";
          break;
        }

        // Calculate delay for next attempt (exponential backoff)
        const delay =
          config.initialDelayMs * Math.pow(config.backoffFactor, attempt);
        await this.sleep(delay);
      } catch (error) {
        const durationMs = Date.now() - startTime;
        const errorMsg = error instanceof Error ? error.message : String(error);

        attempts.push({
          attemptNumber: attempt,
          success: false,
          error: errorMsg,
          durationMs,
          timestamp,
        });

        lastError = errorMsg;

        // If this was the last attempt, we're done
        if (attempt >= config.maxRetries) {
          break;
        }

        // Calculate delay for next attempt
        const delay =
          config.initialDelayMs * Math.pow(config.backoffFactor, attempt);
        await this.sleep(delay);
      }
    }

    // All retries exhausted
    const finalResult: NodeResult = {
      success: false,
      state: state ?? {},
      error: lastError || "Max retries exceeded",
    };

    // Handle escalation if configured
    let escalated = false;
    let escalationReason: string | undefined;

    if (config.escalateOnFailure && this.escalationHandler) {
      try {
        await this.escalationHandler(
          nodeId,
          attempts,
          lastError || "Unknown error",
        );
        escalated = true;
        escalationReason = `Escalated to human after ${config.maxRetries + 1} failed attempts`;
      } catch (escalationError) {
        escalationReason = `Escalation failed: ${escalationError instanceof Error ? escalationError.message : String(escalationError)}`;
      }
    }

    return {
      finalResult,
      attempts,
      escalated,
      escalationReason,
    };
  }

  /**
   * Get retry configuration for a node type.
   */
  getConfig(nodeType: NodeType): RetryConfig {
    return this.configs.get(nodeType) ?? DEFAULT_RETRY_CONFIGS[nodeType];
  }

  /**
   * Update retry configuration for a node type.
   */
  setConfig(nodeType: NodeType, config: Partial<RetryConfig>): void {
    const current =
      this.configs.get(nodeType) ?? DEFAULT_RETRY_CONFIGS[nodeType];
    this.configs.set(nodeType, { ...current, ...config });
  }

  /**
   * Set the escalation handler.
   */
  setEscalationHandler(handler: EscalationHandler): void {
    this.escalationHandler = handler;
  }

  /**
   * Sleep for specified milliseconds.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create a summary of retry attempts for logging/observability.
   */
  summarizeAttempts(attempts: RetryAttempt[]): string {
    if (attempts.length === 0) {
      return "No attempts made";
    }

    const lines: string[] = [];
    lines.push(`Retry attempts: ${attempts.length}`);

    for (const attempt of attempts) {
      const status = attempt.success ? "✓" : "✗";
      const error = attempt.error ? ` (${attempt.error})` : "";
      lines.push(
        `  ${status} Attempt ${attempt.attemptNumber}: ${attempt.durationMs}ms${error}`,
      );
    }

    const totalDuration = attempts.reduce((sum, a) => sum + a.durationMs, 0);
    lines.push(`Total duration: ${totalDuration}ms`);

    return lines.join("\n");
  }
}

/**
 * Default escalation handler that logs to console.
 *
 * In production, this should be replaced with a handler that:
 * - Sends a notification to the user (Telegram, email, etc.)
 * - Pauses execution and waits for human input
 * - Stores the escalation context for later review
 */
export async function defaultEscalationHandler(
  nodeId: string,
  attempts: RetryAttempt[],
  lastError: string,
): Promise<void> {
  console.error(
    `[Blueprint Escalation] Node "${nodeId}" failed after ${attempts.length} attempts`,
  );
  console.error(`[Blueprint Escalation] Last error: ${lastError}`);
  console.error("[Blueprint Escalation] Please review and provide guidance");

  // TODO: Integrate with Telegram/webapp to notify user
  // TODO: Store escalation in database for audit trail
}

/**
 * Create a bounded retry loop with default configuration.
 */
export function createBoundedRetryLoop(options?: {
  escalationHandler?: EscalationHandler;
}): BoundedRetryLoop {
  return new BoundedRetryLoop({
    escalationHandler: options?.escalationHandler ?? defaultEscalationHandler,
  });
}

/**
 * Global retry loop instance.
 *
 * This can be used across the application for consistent retry behavior.
 */
export const globalRetryLoop = createBoundedRetryLoop();
