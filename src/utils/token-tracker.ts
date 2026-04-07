import { createLogger } from "./logger";
import { recordMetric } from "./telemetry";

const logger = createLogger("token-tracker");

// Configuration from environment
const MAX_TOKENS_PER_THREAD = Number.parseInt(
  process.env.MAX_TOKENS_PER_THREAD || "500000",
  10,
);
const MAX_COST_PER_THREAD = Number.parseFloat(
  process.env.MAX_COST_PER_THREAD || "10.0",
);

/**
 * Model pricing map (cost per 1M tokens).
 * Update this as pricing changes.
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI models
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "gpt-4": { input: 30, output: 60 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },

  // Claude models
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },

  // DeepSeek models
  "deepseek-chat": { input: 0.14, output: 0.28 },
  "deepseek-coder": { input: 0.14, output: 0.28 },

  // OpenRouter compatible models
  "openrouter/": { input: 1, output: 2 }, // Fallback pricing
};

/**
 * Token usage for a thread.
 */
export interface ThreadTokenUsage {
  threadId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
  callCount: number;
  lastUpdated: number;
}

/**
 * Token usage storage (in-memory for now).
 * In production, this should be persisted to a database.
 */
const tokenUsageStore = new Map<string, ThreadTokenUsage>();

/**
 * Get pricing for a model.
 */
function getModelPricing(model: string): { input: number; output: number } {
  // Check for exact match
  if (MODEL_PRICING[model]) {
    return MODEL_PRICING[model];
  }

  // Check for prefix match (e.g., "openrouter/*")
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) {
      return pricing;
    }
  }

  // Default pricing (warn about unknown model)
  logger.warn(
    { model },
    "[token-tracker] Unknown model, using default pricing",
  );
  return { input: 1, output: 2 };
}

/**
 * Calculate cost for a model call.
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = getModelPricing(model);

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;

  return inputCost + outputCost;
}

/**
 * Track token usage for a thread.
 */
export function trackTokenUsage(
  threadId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): void {
  const cost = calculateCost(model, inputTokens, outputTokens);

  let usage = tokenUsageStore.get(threadId);
  if (!usage) {
    usage = {
      threadId,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      callCount: 0,
      lastUpdated: Date.now(),
    };
  }

  usage.totalInputTokens += inputTokens;
  usage.totalOutputTokens += outputTokens;
  usage.totalTokens += inputTokens + outputTokens;
  usage.totalCost += cost;
  usage.callCount++;
  usage.lastUpdated = Date.now();

  tokenUsageStore.set(threadId, usage);

  // Record metrics
  recordMetric("tokens.input", inputTokens, { threadId, model });
  recordMetric("tokens.output", outputTokens, { threadId, model });
  recordMetric("tokens.total", inputTokens + outputTokens, { threadId, model });
  recordMetric("cost.usd", cost, { threadId, model });
}

/**
 * Get token usage for a thread.
 */
export function getTokenUsage(threadId: string): ThreadTokenUsage | null {
  return tokenUsageStore.get(threadId) || null;
}

/**
 * Check if a thread is within budget.
 * Returns an object with the check result and details.
 */
export function checkBudget(
  threadId: string,
  inputTokens: number,
  outputTokens: number,
): {
  withinBudget: boolean;
  reason?: string;
  currentUsage: ThreadTokenUsage | null;
} {
  const usage = getTokenUsage(threadId);

  if (!usage) {
    // No usage yet, definitely within budget
    return { withinBudget: true, currentUsage: null };
  }

  // Check token limit
  if (usage.totalTokens + inputTokens + outputTokens > MAX_TOKENS_PER_THREAD) {
    return {
      withinBudget: false,
      reason: `Token limit exceeded. Current: ${usage.totalTokens.toLocaleString()}, Requested: ${
        inputTokens + outputTokens
      }, Limit: ${MAX_TOKENS_PER_THREAD.toLocaleString()}`,
      currentUsage: usage,
    };
  }

  // Check cost limit (estimate based on current model pricing)
  // We'll use a rough estimate since we don't know the model here
  const estimatedCost = (inputTokens + outputTokens) / 1_000_000 * 2; // Conservative $2/1M tokens

  if (usage.totalCost + estimatedCost > MAX_COST_PER_THREAD) {
    return {
      withinBudget: false,
      reason: `Cost limit exceeded. Current: $${usage.totalCost.toFixed(4)}, Estimated: $${estimatedCost.toFixed(4)}, Limit: $${MAX_COST_PER_THREAD.toFixed(2)}`,
      currentUsage: usage,
    };
  }

  return { withinBudget: true, currentUsage: usage };
}

/**
 * Clear token usage for a thread.
 */
export function clearTokenUsage(threadId: string): void {
  tokenUsageStore.delete(threadId);
  logger.debug({ threadId }, "[token-tracker] Token usage cleared");
}

/**
 * Get all thread usage.
 */
export function getAllThreadUsage(): ThreadTokenUsage[] {
  return Array.from(tokenUsageStore.values());
}

/**
 * Get aggregated token statistics across all threads.
 */
export function getTokenStats(): {
  totalThreads: number;
  totalTokens: number;
  totalCost: number;
  totalCalls: number;
  avgTokensPerThread: number;
  avgCostPerThread: number;
} {
  const allUsage = getAllThreadUsage();

  const totalThreads = allUsage.length;
  const totalTokens = allUsage.reduce((sum, u) => sum + u.totalTokens, 0);
  const totalCost = allUsage.reduce((sum, u) => sum + u.totalCost, 0);
  const totalCalls = allUsage.reduce((sum, u) => sum + u.callCount, 0);

  return {
    totalThreads,
    totalTokens,
    totalCost,
    totalCalls,
    avgTokensPerThread: totalThreads > 0 ? totalTokens / totalThreads : 0,
    avgCostPerThread: totalThreads > 0 ? totalCost / totalThreads : 0,
  };
}

/**
 * Check if a thread has exceeded limits and should be stopped.
 * This is called before making an LLM call.
 */
export function shouldStopThread(
  threadId: string,
  inputTokens: number,
  outputTokens: number,
): { shouldStop: boolean; reason?: string } {
  const budgetCheck = checkBudget(threadId, inputTokens, outputTokens);

  if (!budgetCheck.withinBudget) {
    return {
      shouldStop: true,
      reason: budgetCheck.reason || "Budget exceeded",
    };
  }

  return { shouldStop: false };
}

/**
 * Create a formatted budget warning message.
 */
export function formatBudgetWarning(reason: string): string {
  return `[BUDGET WARNING]

${reason}

The agent will stop processing this request.

To continue:
1. Reduce the scope of your task
2. Start a new thread
3. Increase MAX_TOKENS_PER_THREAD or MAX_COST_PER_THREAD if appropriate`;
}
