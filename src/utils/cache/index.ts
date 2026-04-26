/**
 * Cache utilities - Entry point
 *
 * Exports all cache-related utilities for easy importing.
 */

// Main cache class and factory
export {
  GenericCache,
  createCache,
  makeCacheKey,
  calculateSize,
} from "./lru-cache";

// Cache wrapper functions
export {
  cachedCall,
  conditionalCachedCall,
} from "./lru-cache";

// Type definitions
export type {
  CacheEntry,
  CacheStats,
  CacheOptions,
  CacheKeyFunction,
  SizeCalculationFunction,
  CachedCallResult,
} from "./types";

// Cache configuration and defaults
export {
  DEFAULT_CACHE_OPTIONS,
  loadCacheOptions,
  mergeCacheOptions,
} from "./cache-options";
