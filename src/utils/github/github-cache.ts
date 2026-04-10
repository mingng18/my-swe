/**
 * GitHub API caching layer.
 *
 * Provides LRU caching for GitHub API responses to reduce rate limit consumption.
 * Cache is keyed by endpoint + parameters, with a 15-minute TTL.
 */

import { LRUCache } from "lru-cache";

// Cache configuration
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_CACHE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

// Type for cache entry metadata
type CacheEntry<T> = {
  data: T;
  timestamp: number;
  size: number;
};

/**
 * Create a cache key from endpoint and parameters.
 */
function makeCacheKey(
  endpoint: string,
  params: Record<string, unknown> = {}
): string {
  const sortedParams = Object.keys(params)
    .sort()
    .map((k) => `${k}=${JSON.stringify(params[k as keyof typeof params])}`)
    .join("&");
  return `${endpoint}?${sortedParams}`;
}

/**
 * Calculate approximate size of a value in bytes.
 */
function calculateSize(value: unknown): number {
  return JSON.stringify(value).length * 2; // Rough estimate (UTF-16)
}

/**
 * GitHub API cache with LRU eviction.
 */
class GitHubApiCache {
  private cache = new LRUCache<string, CacheEntry<unknown>>({
    maxSize: MAX_CACHE_SIZE_BYTES,
    ttl: CACHE_TTL_MS,
    sizeCalculation: (value) => value.size,
  });

  /**
   * Get a cached value.
   */
  get<T>(endpoint: string, params: Record<string, unknown> = {}): T | null {
    const key = makeCacheKey(endpoint, params);
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    return entry?.data ?? null;
  }

  /**
   * Set a cached value.
   */
  set<T>(endpoint: string, data: T, params: Record<string, unknown> = {}): void {
    const key = makeCacheKey(endpoint, params);
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      size: calculateSize(data),
    };
    this.cache.set(key, entry as CacheEntry<unknown>);
  }

  /**
   * Invalidate cache entries matching a pattern.
   */
  invalidate(pattern: string): void {
    const regex = new RegExp(pattern);
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
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
    return {
      size: this.cache.size,
      calculatedSize: this.cache.calculatedSize ?? 0,
      maxSize: this.cache.maxSize,
      ttl: this.cache.ttl,
    };
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
