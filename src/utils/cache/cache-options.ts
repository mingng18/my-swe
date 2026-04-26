/**
 * Cache configuration defaults and environment variable loading.
 *
 * Provides default values for cache options and loads overrides from
 * environment variables for easy customization without code changes.
 */

import type { CacheOptions } from "./types";

/**
 * Default cache configuration values.
 */
export const DEFAULT_CACHE_OPTIONS = {
  maxSize: 50 * 1024 * 1024, // 50MB
  ttl: 15 * 60 * 1000, // 15 minutes
} as const;

/**
 * Load cache options from environment variables.
 *
 * Reads CACHE_* environment variables to override defaults:
 * - CACHE_DEFAULT_MAX_SIZE_MB: Maximum cache size in megabytes
 * - CACHE_DEFAULT_TTL_MS: Default time-to-live in milliseconds
 * - CACHE_DEBUG: Enable debug logging ("true" or "1")
 *
 * @returns Cache options with environment variable overrides applied
 *
 * @example
 * ```ts
 * // Load from environment
 * const options = loadCacheOptions();
 *
 * // Or use defaults
 * const options = DEFAULT_CACHE_OPTIONS;
 * ```
 */
export function loadCacheOptions(): Partial<CacheOptions> {
  const maxSizeMB = parseInt(process.env.CACHE_DEFAULT_MAX_SIZE_MB || "", 10);
  const ttlMs = parseInt(process.env.CACHE_DEFAULT_TTL_MS || "", 10);
  const debug = process.env.CACHE_DEBUG;

  const options: Partial<CacheOptions> = {};

  if (!isNaN(maxSizeMB) && maxSizeMB > 0) {
    options.maxSize = maxSizeMB * 1024 * 1024; // Convert MB to bytes
  }

  if (!isNaN(ttlMs) && ttlMs > 0) {
    options.ttl = ttlMs;
  }

  if (debug === "true" || debug === "1") {
    options.debug = "GenericCache";
  }

  return options;
}

/**
 * Merge user-provided options with defaults and environment variables.
 *
 * Priority (highest to lowest):
 * 1. User-provided options
 * 2. Environment variables
 * 3. Default values
 *
 * @param userOptions - User-provided options
 * @returns Merged cache options
 *
 * @example
 * ```ts
 * const options = mergeCacheOptions({
 *   ttl: 30 * 60 * 1000, // 30 minutes (overrides defaults and env)
 * });
 * ```
 */
export function mergeCacheOptions(
  userOptions: Partial<CacheOptions> = {}
): Required<Omit<CacheOptions, "sizeCalculation" | "keyFunction" | "debug">> &
  Partial<Pick<CacheOptions, "sizeCalculation" | "keyFunction" | "debug">> {
  const envOptions = loadCacheOptions();

  return {
    maxSize:
      userOptions.maxSize ??
      envOptions.maxSize ??
      DEFAULT_CACHE_OPTIONS.maxSize,
    ttl:
      userOptions.ttl ?? envOptions.ttl ?? DEFAULT_CACHE_OPTIONS.ttl,
    sizeCalculation: userOptions.sizeCalculation,
    keyFunction: userOptions.keyFunction,
    debug: userOptions.debug ?? envOptions.debug,
  };
}
