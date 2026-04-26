/**
 * GitHub API caching layer.
 *
 * Provides LRU caching for GitHub API responses to reduce rate limit consumption.
 * Cache is keyed by endpoint + parameters, with a 15-minute TTL.
 *
 * Uses the GenericCache utility internally for consistent caching behavior
 * across the codebase.
 */

import { GenericCache } from "../cache/lru-cache";

// Cache configuration
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_CACHE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

/**
 * GitHub API cache with LRU eviction.
 *
 * Wraps the GenericCache to provide a GitHub-specific caching interface
 * with enhanced statistics and pattern-based invalidation.
 */
class GitHubApiCache {
  private cache: GenericCache;

  constructor() {
    this.cache = new GenericCache({
      maxSize: MAX_CACHE_SIZE_BYTES,
      ttl: CACHE_TTL_MS,
      debug: "github-cache",
    });
  }

  /**
   * Get a cached value.
   */
  get<T>(endpoint: string, params: Record<string, unknown> = {}): T | null {
    return this.cache.get<T>(endpoint, params);
  }

  /**
   * Set a cached value.
   */
  set<T>(endpoint: string, data: T, params: Record<string, unknown> = {}): void {
    this.cache.set(endpoint, data, params);
  }

  /**
   * Invalidate cache entries matching a pattern.
   */
  invalidate(pattern: string): void {
    this.cache.invalidate(pattern);
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics.
   */
  getStats() {
    return this.cache.getStats();
  }
}

// Global cache instance
export const githubApiCache = new GitHubApiCache();

/**
 * Wrapper function for cached GitHub API calls.
 * Caches GET requests but skips POST/PUT/PATCH/DELETE.
 */
export async function cachedGithubApiCall<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  endpoint: string,
  params: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  // Only cache GET requests
  if (method !== "GET") {
    return fn();
  }

  // Check cache
  const cached = githubApiCache.get<T>(endpoint, params);
  if (cached !== null) {
    console.debug(`[github-cache] Cache hit: ${endpoint}`);
    return cached;
  }

  console.debug(`[github-cache] Cache miss: ${endpoint}`);
  const result = await fn();

  // Cache the result
  githubApiCache.set(endpoint, result, params);

  return result;
}

/**
 * Invalidate cache entries for a specific repository.
 * Call this after creating/updating PRs, comments, etc.
 */
export function invalidateRepoCache(
  owner: string,
  repo: string
): void {
  githubApiCache.invalidate(`${owner}/${repo}`);
}

/**
 * Invalidate cache entries for PRs in a repository.
 */
export function invalidatePrCache(owner: string, repo: string): void {
  githubApiCache.invalidate(`pulls.*owner=${owner}.*repo=${repo}`);
}
