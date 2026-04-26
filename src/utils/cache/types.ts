/**
 * Type definitions for the generic caching utility.
 */

/**
 * Cache entry metadata stored alongside cached data.
 */
export type CacheEntry<T> = {
  /** The cached data value */
  data: T;
  /** Timestamp when the entry was cached (milliseconds since epoch) */
  timestamp: number;
  /** Approximate size of the entry in bytes */
  size: number;
  /** Number of times this entry has been retrieved (for statistics) */
  hits?: number;
};

/**
 * Cache key generation function.
 * Converts a base key and parameters into a string cache key.
 */
export type CacheKeyFunction = (
  key: string,
  params: Record<string, unknown>
) => string;

/**
 * Cache size calculation function.
 * Estimates the size of a value in bytes for cache eviction.
 */
export type SizeCalculationFunction<T> = (value: T) => number;

/**
 * Cache statistics for monitoring and observability.
 */
export interface CacheStats {
  /** Number of entries currently in the cache */
  size: number;
  /** Total calculated size of all entries in bytes */
  calculatedSize: number;
  /** Maximum cache size in bytes */
  maxSize: number;
  /** Time-to-live for cache entries in milliseconds */
  ttl: number;
  /** Total number of cache hits (successful retrievals) */
  hits: number;
  /** Total number of cache misses (failed retrievals) */
  misses: number;
  /** Cache hit ratio (hits / (hits + misses)) */
  hitRatio: number;
}

/**
 * Configuration options for creating a GenericCache instance.
 */
export interface CacheOptions {
  /** Maximum cache size in bytes (default: 50MB) */
  maxSize?: number;
  /** Time-to-live for cache entries in milliseconds (default: 15 minutes) */
  ttl?: number;
  /** Custom function to calculate entry size (default: JSON string length * 2) */
  sizeCalculation?: SizeCalculationFunction<unknown>;
  /** Custom function to generate cache keys (default: sorts params and JSON stringifies) */
  keyFunction?: CacheKeyFunction;
  /** Enable debug logging (default: false) */
  debug?: string;
}

/**
 * Result of a cache wrapper function (like cachedCall).
 */
export interface CachedCallResult<T> {
  /** The result value (cached or fresh) */
  data: T;
  /** Whether the value was retrieved from cache */
  fromCache: boolean;
  /** Cache statistics at retrieval time */
  stats: CacheStats;
}
