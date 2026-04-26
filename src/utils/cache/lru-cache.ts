/**
 * Generic LRU Cache Utility
 *
 * A reusable caching utility that provides LRU (Least Recently Used) eviction
 * with size-based limits, TTL (Time To Live) expiration, and configurable
 * cache key generation. Extracted from the GitHub caching pattern for use
 * across semantic-search, memory-search, and other tools.
 *
 * Features:
 * - LRU eviction with size-based limits
 * - TTL-based expiration
 * - Configurable cache key generation from parameters
 * - Cache statistics (hits, misses, hit ratio)
 * - Pattern-based cache invalidation
 * - Generic type support for type-safe caching
 *
 * @example
 * ```ts
 * // Create a cache instance
 * const cache = new GenericCache<string>({
 *   maxSize: 100 * 1024 * 1024, // 100MB
 *   ttl: 30 * 60 * 1000, // 30 minutes
 * });
 *
 * // Store a value
 * cache.set("user:123", { name: "Alice", email: "alice@example.com" });
 *
 * // Retrieve a value
 * const user = cache.get<UserType>("user:123");
 *
 * // Invalidate by pattern
 * cache.invalidate("user:*");
 *
 * // Get statistics
 * const stats = cache.getStats();
 * console.log(`Hit ratio: ${(stats.hitRatio * 100).toFixed(1)}%`);
 * ```
 */

import { LRUCache } from "lru-cache";
import type {
  CacheEntry,
  CacheStats,
  CacheKeyFunction,
  SizeCalculationFunction,
} from "./types";
import {
  DEFAULT_CACHE_OPTIONS,
  mergeCacheOptions,
} from "./cache-options";

/**
 * Default cache key generation function.
 *
 * Creates a cache key from a base key and parameters by:
 * 1. Sorting parameter keys alphabetically
 * 2. Stringifying each parameter value
 * 3. Joining with '&' in key=value format
 * 4. Appending to the base key with '?'
 *
 * @param key - Base cache key
 * @param params - Parameters to include in the cache key
 * @returns Generated cache key string
 *
 * @example
 * ```ts
 * makeCacheKey("users", { id: 123, active: true })
 * // Returns: "users?active=true&id=123"
 * ```
 */
export function makeCacheKey(
  key: string,
  params: Record<string, unknown> = {}
): string {
  if (Object.keys(params).length === 0) {
    return key;
  }

  const sortedParams = Object.keys(params)
    .sort()
    .map((k) => `${k}=${JSON.stringify(params[k as keyof typeof params])}`)
    .join("&");
  return `${key}?${sortedParams}`;
}

/**
 * Default size calculation function.
 *
 * Estimates the size of a value in bytes by measuring its JSON string
 * representation and multiplying by 2 (for UTF-16 encoding). This is
 * a rough estimate but works well for most caching scenarios.
 *
 * @param value - Value to calculate size for
 * @returns Estimated size in bytes
 */
export function calculateSize(value: unknown): number {
  return JSON.stringify(value).length * 2; // Rough estimate (UTF-16)
}

/**
 * Generic LRU cache with size-based eviction and TTL expiration.
 *
 * Provides a flexible caching solution that can be used across the codebase
 * for API responses, file contents, database queries, and more.
 */
export class GenericCache {
  private cache: LRUCache<string, CacheEntry<unknown>>;
  private hits: number = 0;
  private misses: number = 0;
  private readonly debug?: string;

  /**
   * Create a new GenericCache instance.
   *
   * @param options - Cache configuration options
   *
   * @example
   * ```ts
   * const cache = new GenericCache({
   *   maxSize: 100 * 1024 * 1024, // 100MB
   *   ttl: 30 * 60 * 1000, // 30 minutes
   *   debug: "MyCache",
   * });
   * ```
   */
  constructor(options: {
    maxSize?: number;
    ttl?: number;
    sizeCalculation?: SizeCalculationFunction<unknown>;
    keyFunction?: CacheKeyFunction;
    debug?: string;
  } = {}) {
    const mergedOptions = mergeCacheOptions(options);

    this.debug = options.debug;

    this.cache = new LRUCache<string, CacheEntry<unknown>>({
      maxSize: mergedOptions.maxSize,
      ttl: mergedOptions.ttl,
      sizeCalculation: (value) => value.size,
    });

    if (this.debug) {
      console.debug(
        `[${this.debug}] Initialized with maxSize=${mergedOptions.maxSize}, ttl=${mergedOptions.ttl}`
      );
    }
  }

  /**
   * Get a cached value by key.
   *
   * @param key - Cache key (base key without parameters)
   * @param params - Optional parameters to append to the cache key
   * @returns The cached value, or null if not found or expired
   *
   * @example
   * ```ts
   * const value = cache.get<UserType>("user:123");
   * const withParams = cache.get<ResponseData>("api/users", { page: 1, limit: 10 });
   * ```
   */
  get<T>(key: string, params: Record<string, unknown> = {}): T | null {
    const cacheKey = makeCacheKey(key, params);
    const entry = this.cache.get(cacheKey) as CacheEntry<T> | undefined;

    if (entry) {
      this.hits++;
      entry.hits = (entry.hits ?? 0) + 1;

      if (this.debug) {
        console.debug(`[${this.debug}] Cache hit: ${cacheKey}`);
      }

      return entry.data;
    }

    this.misses++;

    if (this.debug) {
      console.debug(`[${this.debug}] Cache miss: ${cacheKey}`);
    }

    return null;
  }

  /**
   * Store a value in the cache.
   *
   * @param key - Cache key (base key without parameters)
   * @param data - Value to cache
   * @param params - Optional parameters to append to the cache key
   *
   * @example
   * ```ts
   * cache.set("user:123", { name: "Alice" });
   * cache.set("api/users", responseData, { page: 1, limit: 10 });
   * ```
   */
  set<T>(key: string, data: T, params: Record<string, unknown> = {}): void {
    const cacheKey = makeCacheKey(key, params);
    const size = calculateSize(data);

    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      size,
      hits: 0,
    };

    this.cache.set(cacheKey, entry as CacheEntry<unknown>);

    if (this.debug) {
      console.debug(
        `[${this.debug}] Cache set: ${cacheKey} (size: ${size} bytes, total entries: ${this.cache.size})`
      );
    }
  }

  /**
   * Check if a key exists in the cache (without marking it as used).
   *
   * @param key - Cache key to check
   * @param params - Optional parameters to append to the cache key
   * @returns True if the key exists and is not expired
   *
   * @example
   * ```ts
   * if (cache.has("user:123")) {
   *   console.log("User data is cached");
   * }
   * ```
   */
  has(key: string, params: Record<string, unknown> = {}): boolean {
    const cacheKey = makeCacheKey(key, params);
    return this.cache.has(cacheKey);
  }

  /**
   * Delete a specific entry from the cache.
   *
   * @param key - Cache key to delete
   * @param params - Optional parameters to append to the cache key
   * @returns True if the entry was deleted, false if it didn't exist
   *
   * @example
   * ```ts
   * cache.delete("user:123");
   * ```
   */
  delete(key: string, params: Record<string, unknown> = {}): boolean {
    const cacheKey = makeCacheKey(key, params);
    const deleted = this.cache.delete(cacheKey);

    if (this.debug && deleted) {
      console.debug(`[${this.debug}] Cache delete: ${cacheKey}`);
    }

    return deleted;
  }

  /**
   * Invalidate cache entries matching a regex pattern.
   *
 * Useful for bulk invalidation when you know a set of keys is no longer valid.
   * For example, after updating a user, invalidate all cache entries prefixed
   * with that user's ID.
   *
   * @param pattern - Regular expression pattern to match keys against
   * @returns Number of entries invalidated
   *
   * @example
   * ```ts
   * // Invalidate all user-related cache entries
   * cache.invalidate("user:.*");
   *
   * // Invalidate all entries for a specific repository
   * cache.invalidate("repos/owner/repo/.*");
   *
   * // Invalidate all pagination results for an endpoint
   * cache.invalidate("api/users.*page=");
   * ```
   */
  invalidate(pattern: string): number {
    const regex = new RegExp(pattern);
    let count = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }

    if (this.debug) {
      console.debug(
        `[${this.debug}] Cache invalidate: ${pattern} (${count} entries removed)`
      );
    }

    return count;
  }

  /**
   * Clear all cached entries.
   *
   * @example
   * ```ts
   * cache.clear();
   * console.log("Cache is now empty");
   * ```
   */
  clear(): void {
    const previousSize = this.cache.size;
    this.cache.clear();

    if (this.debug) {
      console.debug(
        `[${this.debug}] Cache cleared (${previousSize} entries removed)`
      );
    }
  }

  /**
   * Get cache statistics.
   *
   * Useful for monitoring cache effectiveness and tuning cache parameters.
   *
   * @returns Current cache statistics
   *
   * @example
   * ```ts
   * const stats = cache.getStats();
   * console.log(`Hit ratio: ${(stats.hitRatio * 100).toFixed(1)}%`);
   * console.log(`Entries: ${stats.size} / ${stats.maxSize} bytes`);
   * ```
   */
  getStats(): CacheStats {
    const totalRequests = this.hits + this.misses;
    const hitRatio = totalRequests > 0 ? this.hits / totalRequests : 0;

    return {
      size: this.cache.size,
      calculatedSize: this.cache.calculatedSize ?? 0,
      maxSize: this.cache.maxSize,
      ttl: this.cache.ttl ?? 0,
      hits: this.hits,
      misses: this.misses,
      hitRatio,
    };
  }

  /**
   * Reset hit/miss counters.
   *
   * Useful for periodic statistics collection or testing.
   *
   * @example
   * ```ts
   * // Every hour, log stats and reset counters
   * setInterval(() => {
   *   const stats = cache.getStats();
   *   console.log(stats);
   *   cache.resetStats();
   * }, 60 * 60 * 1000);
   * ```
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;

    if (this.debug) {
      console.debug(`[${this.debug}] Cache stats reset`);
    }
  }
}

/**
 * Factory function to create a new GenericCache instance.
 *
 * Convenience function that provides a more concise syntax for creating
 * cache instances with default options.
 *
 * @param options - Cache configuration options
 * @returns A new GenericCache instance
 *
 * @example
 * ```ts
 * // Using the factory function
 * const cache = createCache({ ttl: 60 * 60 * 1000 }); // 1 hour
 *
 * // Equivalent to
 * const cache = new GenericCache({ ttl: 60 * 60 * 1000 });
 * ```
 */
export function createCache(options?: {
  maxSize?: number;
  ttl?: number;
  sizeCalculation?: SizeCalculationFunction<unknown>;
  keyFunction?: CacheKeyFunction;
  debug?: string;
}): GenericCache {
  return new GenericCache(options);
}

/**
 * Wrapper function for cached API calls.
 *
 * Wraps an async function with caching logic. On first call, executes the
 * function and caches the result. Subsequent calls with the same parameters
 * return the cached value (if not expired).
 *
 * This is useful for caching expensive operations like API calls,
 * database queries, or file reads.
 *
 * @param cache - GenericCache instance to use
 * @param key - Cache key (base key without parameters)
 * @param params - Parameters that affect the result (used for cache key)
 * @param fn - Async function to execute if cache miss
 * @returns Promise resolving to the result (cached or fresh)
 *
 * @example
 * ```ts
 * const cache = new GenericCache();
 *
 * async function fetchUser(userId: string) {
 *   return await cachedCall(
 *     cache,
 *     "user",
 *     { userId },
 *     async () => {
 *       const response = await fetch(`/api/users/${userId}`);
 *       return response.json();
 *     }
 *   );
 * }
 * ```
 */
export async function cachedCall<T>(
  cache: GenericCache,
  key: string,
  params: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  // Check cache
  const cached = cache.get<T>(key, params);
  if (cached !== null) {
    return cached;
  }

  // Cache miss - execute function
  const result = await fn();

  // Cache the result
  cache.set(key, result, params);

  return result;
}

/**
 * Conditional caching wrapper that can be enabled/disabled at runtime.
 *
 * Similar to cachedCall, but includes a shouldCache parameter that allows
 * you to conditionally bypass the cache (e.g., for POST/PUT/DELETE requests).
 *
 * @param cache - GenericCache instance to use
 * @param shouldCache - Whether to use cache (if false, always executes fn)
 * @param key - Cache key (base key without parameters)
 * @param params - Parameters that affect the result (used for cache key)
 * @param fn - Async function to execute
 * @returns Promise resolving to the result
 *
 * @example
 * ```ts
 * const cache = new GenericCache();
 *
 * async function apiCall(method: string, endpoint: string, params: object) {
 *   return await conditionalCachedCall(
 *     cache,
 *     method === "GET", // Only cache GET requests
 *     endpoint,
 *     params,
 *     async () => fetchApi(method, endpoint, params)
 *   );
 * }
 * ```
 */
export async function conditionalCachedCall<T>(
  cache: GenericCache,
  shouldCache: boolean,
  key: string,
  params: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  if (!shouldCache) {
    return fn();
  }

  return cachedCall(cache, key, params, fn);
}
