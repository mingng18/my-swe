import { createLogger } from "./logger";
import {
  TASK_OVERVIEW_SECTION,
  FILE_MANAGEMENT_SECTION,
  TASK_EXECUTION_SECTION,
  TOOL_USAGE_SECTION,
  TOOL_BEST_PRACTICES_SECTION,
  CODE_INVESTIGATION_SECTION,
  CODING_STANDARDS_SECTION,
  CORE_BEHAVIOR_SECTION,
  DEPENDENCY_SECTION,
  CODE_REVIEW_GUIDELINES_SECTION,
  COMMUNICATION_SECTION,
  EXTERNAL_UNTRUSTED_COMMENTS_SECTION,
  COMMIT_PR_SECTION,
  getWorkingEnvSection,
  constructSystemPrompt,
  type SystemPrompt,
} from "../prompt";

const logger = createLogger("prompt-manager");

/**
 * Prompt tier levels
 */
export enum PromptTier {
  FULL = "full", // All examples, detailed instructions
  STANDARD = "standard", // Core instructions, key examples
  MINIMAL = "minimal", // Bare instructions, no examples
}

/**
 * Token thresholds for each tier
 */
const TIER_THRESHOLDS = {
  [PromptTier.FULL]: 30000, // Use full prompt when context < 30k tokens
  [PromptTier.STANDARD]: 60000, // Use standard prompt when context < 60k tokens
  [PromptTier.MINIMAL]: 90000, // Use minimal prompt when context < 90k tokens
};

/**
 * Cache for static prompt portions
 */
interface PromptCache {
  hash: string;
  prompt: string;
  timestamp: number;
}

const promptCache = new Map<string, PromptCache>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Create a simple hash of a string for cache key
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Estimate token count for a string
 */
function estimateTokens(str: string): number {
  return Math.ceil(str.length / 4);
}

/**
 * Determine the appropriate prompt tier based on context size.
 *
 * @param contextTokens - Estimated token count of current context
 * @returns Appropriate prompt tier
 */
export function getPromptTier(contextTokens: number): PromptTier {
  if (contextTokens < TIER_THRESHOLDS[PromptTier.FULL]) {
    return PromptTier.FULL;
  } else if (contextTokens < TIER_THRESHOLDS[PromptTier.STANDARD]) {
    return PromptTier.STANDARD;
  } else {
    return PromptTier.MINIMAL;
  }
}

/**
 * Build a system prompt for a specific tier.
 *
 * Full tier: All sections with detailed examples
 * Standard tier: Core sections, fewer examples
 * Minimal tier: Only essential instructions
 */
export async function buildPromptForTier(
  tier: PromptTier,
  workingDir: string,
  agentsMd: string = "",
): Promise<string> {
  // For FULL tier, use the standard prompt
  if (tier === PromptTier.FULL) {
    return await constructSystemPrompt(workingDir, "", "", agentsMd);
  }

  // For STANDARD tier, remove verbose sections
  if (tier === PromptTier.STANDARD) {
    const sections = [
      TASK_OVERVIEW_SECTION,
      getWorkingEnvSection(workingDir),
      TASK_EXECUTION_SECTION,
      TOOL_USAGE_SECTION,
      CODE_INVESTIGATION_SECTION,
      CODING_STANDARDS_SECTION,
      CORE_BEHAVIOR_SECTION,
      COMMIT_PR_SECTION,
    ];

    if (agentsMd) {
      sections.push(
        `\nThe following text is pulled from the repository's AGENTS.md file:\n<agents_md>\n${agentsMd}\n</agents_md>`,
      );
    }

    return sections.filter(Boolean).join("\n\n");
  }

  // For MINIMAL tier, only essential instructions
  if (tier === PromptTier.MINIMAL) {
    const minimalSections = [
      `### Working Environment\n\nYou are in a remote Linux sandbox at \`${workingDir}\`.\n`,
      `### Core Rules\n\n1. Use tools for ALL operations. Never claim to do something without calling a tool.\n2. After completing work, call commit_and_open_pr to push changes.\n3. STOP after the final reply. No additional tool calls.`,
      `### Key Tools\n\n- code_search: Search code or read file ranges\n- sandbox_shell: Execute commands\n- commit_and_open_pr: Commit and push changes`,
      `### Workflow\n\n1. Understand the task\n2. Make minimal changes\n3. Run tests/linter\n4. Commit with commit_and_open_pr\n5. STOP`,
    ];

    return minimalSections.join("\n\n");
  }

  // Fallback
  return await constructSystemPrompt(workingDir, "", "", agentsMd);
}

/**
 * Get a cached prompt if available and not expired.
 *
 * @param cacheKey - Key for the cache entry
 * @returns Cached prompt or null
 */
function getCachedPrompt(cacheKey: string): string | null {
  const cached = promptCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  // Check if cache has expired
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    promptCache.delete(cacheKey);
    return null;
  }

  logger.debug({ cacheKey }, "[prompt-manager] Using cached prompt");
  return cached.prompt;
}

/**
 * Cache a prompt for future use.
 *
 * @param cacheKey - Key for the cache entry
 * @param prompt - Prompt to cache
 */
function cachePrompt(cacheKey: string, prompt: string): void {
  promptCache.set(cacheKey, {
    hash: cacheKey,
    prompt,
    timestamp: Date.now(),
  });
}

/**
 * Get the optimal system prompt based on current context size.
 * Uses caching for static portions to improve performance.
 *
 * @param contextMessages - Current messages in context
 * @param workingDir - Working directory
 * @param agentsMd - Optional AGENTS.md content
 * @returns Optimized system prompt
 */
export async function getOptimizedSystemPrompt(
  contextMessages: unknown[],
  workingDir: string,
  agentsMd: string = "",
): Promise<string> {
  // Estimate context token count
  let contextTokens = 0;
  for (const msg of contextMessages) {
    if (msg && typeof msg === "object") {
      const content = (msg as any).content;
      if (typeof content === "string") {
        contextTokens += estimateTokens(content);
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === "text" && part.text) {
            contextTokens += estimateTokens(part.text);
          }
        }
      }
    }
  }

  // Determine appropriate tier
  const tier = getPromptTier(contextTokens);

  logger.debug(
    { contextTokens, tier, messageCount: contextMessages.length },
    "[prompt-manager] Selected prompt tier",
  );

  // Create cache key based on tier and working dir
  const agentsMdHash = agentsMd ? simpleHash(agentsMd) : "none";
  const cacheKey = `${tier}:${workingDir}:${agentsMdHash}`;

  // Check cache first
  const cached = getCachedPrompt(cacheKey);
  if (cached) {
    return cached;
  }

  // Build prompt for this tier
  const prompt = await buildPromptForTier(tier, workingDir, agentsMd);

  // Cache it
  cachePrompt(cacheKey, prompt);

  return prompt;
}

/**
 * Clear expired cache entries.
 * Should be called periodically to prevent memory buildup.
 */
export function clearExpiredCache(): number {
  let cleared = 0;
  const now = Date.now();

  for (const [key, entry] of promptCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      promptCache.delete(key);
      cleared++;
    }
  }

  if (cleared > 0) {
    logger.debug({ cleared }, "[prompt-manager] Cleared expired cache entries");
  }

  return cleared;
}

/**
 * Clear all cached prompts.
 * Useful when configuration changes.
 */
export function clearAllCache(): void {
  const size = promptCache.size;
  promptCache.clear();
  logger.debug({ size }, "[prompt-manager] Cleared all cache entries");
}

/**
 * Get statistics about the prompt cache.
 */
export function getCacheStats(): { size: number; keys: string[] } {
  return {
    size: promptCache.size,
    keys: Array.from(promptCache.keys()),
  };
}
