/**
 * Multi-dimensional rate limiting for API endpoints.
 * Supports rate limiting by IP, thread ID, and user ID combinations.
 */

import { createLogger } from "./logger";
import { LRUCache } from "lru-cache";

const logger = createLogger("rate-limit");

/**
 * Rate limit key structure.
 */
interface RateLimitKey {
  ip: string;
  threadId?: string;
  userId?: string;
  endpoint: string;
}

/**
 * Rate limit configuration.
 */
interface RateLimitConfig {
  perMinute: number;
  perHour: number;
  perThread?: number;
  perUser?: number;
}

/**
 * Rate limit result.
 */
interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number;
  limit: number;
  remaining: number;
  resetTime: number;
}

/**
 * Default rate limits.
 */
const DEFAULT_LIMITS: RateLimitConfig = {
  perMinute: 20,
  perHour: 100,
  perThread: 50,
  perUser: 200,
};

/**
 * Find the first index in a sorted array where the value is strictly greater than the threshold.
 * Uses binary search for O(log N) performance.
 */
function findFirstIdxGreaterThan(arr: number[], threshold: number): number {
  let start = 0;
  let end = arr.length - 1;
  let idx = arr.length;

  while (start <= end) {
    const mid = (start + end) >> 1; // Faster integer division
    if (arr[mid] > threshold) {
      idx = mid;
      end = mid - 1; // Look left for an earlier element
    } else {
      start = mid + 1; // Look right
    }
  }

  return idx;
}

/**
 * Multi-dimensional rate limiter.
 */
export class MultiDimensionalRateLimiter {
  private limits = new Map<string, number[]>();
  private windows = new Map<string, number[]>();

  /**
   * Check if a request is within rate limits.
   */
  async checkLimit(
    key: RateLimitKey,
    config: RateLimitConfig = DEFAULT_LIMITS,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const keyStr = this.serializeKey(key);

    // Get or create window
    let timestamps = this.windows.get(keyStr);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(keyStr, timestamps);
    }

    // Clean old timestamps (older than 1 hour)
    // ⚡ Bolt: Use binary search instead of O(N) array filtering.
    // Since we only ever push Date.now(), arrays are naturally sorted.
    const oneHourAgo = now - 3600000;
    const hourStartIdx = findFirstIdxGreaterThan(timestamps, oneHourAgo);
    if (hourStartIdx > 0) {
      timestamps.splice(0, hourStartIdx);
    }
    // timestamps is updated in-place, but let's re-set it to be safe
    this.windows.set(keyStr, timestamps);

    // Check per-minute limit
    const oneMinuteAgo = now - 60000;
    const minuteStartIdx = findFirstIdxGreaterThan(timestamps, oneMinuteAgo);
    const minuteCount = timestamps.length - minuteStartIdx;

    if (minuteCount >= config.perMinute) {
      logger.warn(
        { ip: key.ip, endpoint: key.endpoint, limit: config.perMinute },
        "[rate-limit] Per-minute limit exceeded",
      );

      return {
        allowed: false,
        retryAfter: 60,
        limit: config.perMinute,
        remaining: 0,
        resetTime: this.getNextResetTime(timestamps.slice(minuteStartIdx), 60000),
      };
    }

    // Check per-hour limit
    if (timestamps.length >= config.perHour) {
      logger.warn(
        { ip: key.ip, endpoint: key.endpoint, limit: config.perHour },
        "[rate-limit] Per-hour limit exceeded",
      );

      return {
        allowed: false,
        retryAfter: 3600,
        limit: config.perHour,
        remaining: 0,
        resetTime: this.getNextResetTime(timestamps, 3600000),
      };
    }

    // Check per-thread limit (if specified)
    if (config.perThread && key.threadId) {
      const threadKey = this.serializeKey({ ...key, endpoint: `${key.endpoint}:thread` });
      const threadTimestamps = this.windows.get(threadKey) || [];
      const threadMinuteStartIdx = findFirstIdxGreaterThan(threadTimestamps, oneMinuteAgo);
      const threadMinuteCount = threadTimestamps.length - threadMinuteStartIdx;

      if (threadMinuteCount >= config.perThread) {
        logger.warn(
          { ip: key.ip, threadId: key.threadId, endpoint: key.endpoint, limit: config.perThread },
          "[rate-limit] Per-thread limit exceeded",
        );

        return {
          allowed: false,
          retryAfter: 60,
          limit: config.perThread,
          remaining: 0,
          resetTime: this.getNextResetTime(threadTimestamps.slice(threadMinuteStartIdx), 60000),
        };
      }
    }

    // Check per-user limit (if specified)
    if (config.perUser && key.userId) {
      const userKey = this.serializeKey({ ...key, endpoint: `${key.endpoint}:user` });
      const userTimestamps = this.windows.get(userKey) || [];
      const userMinuteStartIdx = findFirstIdxGreaterThan(userTimestamps, oneMinuteAgo);
      const userMinuteCount = userTimestamps.length - userMinuteStartIdx;

      if (userMinuteCount >= config.perUser) {
        logger.warn(
          { ip: key.ip, userId: key.userId, endpoint: key.endpoint, limit: config.perUser },
          "[rate-limit] Per-user limit exceeded",
        );

        return {
          allowed: false,
          retryAfter: 60,
          limit: config.perUser,
          remaining: 0,
          resetTime: this.getNextResetTime(userTimestamps.slice(userMinuteStartIdx), 60000),
        };
      }
    }

    // Request is allowed - record it
    timestamps.push(now);
    this.windows.set(keyStr, timestamps);

    // Also record in thread/user specific windows
    if (config.perThread && key.threadId) {
      const threadKey = this.serializeKey({ ...key, endpoint: `${key.endpoint}:thread` });
      const threadTimestamps = this.windows.get(threadKey) || [];
      threadTimestamps.push(now);
      this.windows.set(threadKey, threadTimestamps);
    }

    if (config.perUser && key.userId) {
      const userKey = this.serializeKey({ ...key, endpoint: `${key.endpoint}:user` });
      const userTimestamps = this.windows.get(userKey) || [];
      userTimestamps.push(now);
      this.windows.set(userKey, userTimestamps);
    }

    return {
      allowed: true,
      limit: config.perMinute,
      remaining: config.perMinute - minuteCount - 1,
      resetTime: this.getNextResetTime(timestamps.slice(minuteStartIdx), 60000),
    };
  }

  /**
   * Get statistics for a specific key.
   */
  getStats(key: RateLimitKey): {
    minuteCount: number;
    hourCount: number;
    windowSize: number;
  } {
    const now = Date.now();
    const keyStr = this.serializeKey(key);
    const timestamps = this.windows.get(keyStr) || [];

    const oneMinuteAgo = now - 60000;
    const oneHourAgo = now - 3600000;

    const minuteIdx = findFirstIdxGreaterThan(timestamps, oneMinuteAgo);
    const minuteCount = timestamps.length - minuteIdx;

    const hourIdx = findFirstIdxGreaterThan(timestamps, oneHourAgo);
    const hourCount = timestamps.length - hourIdx;

    return {
      minuteCount,
      hourCount,
      windowSize: timestamps.length,
    };
  }

  /**
   * Clear rate limit history for a specific key.
   */
  clear(key: RateLimitKey): void {
    const keyStr = this.serializeKey(key);
    this.windows.delete(keyStr);
  }

  /**
   * Clear all rate limit history (for testing).
   */
  clearAll(): void {
    this.windows.clear();
  }

  /**
   * Get the next reset time based on the oldest timestamp in the window.
   */
  private getNextResetTime(timestamps: number[], windowMs: number): number {
    if (timestamps.length === 0) {
      return Date.now() + windowMs;
    }

    // ⚡ Bolt: Since timestamps are pushed sequentially, the array is naturally chronologically sorted.
    // Replace O(N) Math.min array spread with an O(1) first element lookup.
    const oldestTimestamp = timestamps[0];
    return oldestTimestamp + windowMs;
  }

  /**
   * Serialize a rate limit key to a string.
   */
  private serializeKey(key: RateLimitKey): string {
    const parts = [
      key.ip,
      key.endpoint,
      key.threadId || "",
      key.userId || "",
    ];
    return parts.join(":");
  }
}

/**
 * Create a rate limiter instance.
 */
export const rateLimiter = new MultiDimensionalRateLimiter();

/**
 * Hono middleware factory for rate limiting.
 */
export function createRateLimitMiddleware(
  endpoint: string,
  config?: RateLimitConfig,
) {
  return async (c: any, next: any) => {
    const ip =
      c.req.header("x-forwarded-for") ||
      c.req.header("x-real-ip") ||
      "unknown";

    const threadId = c.req.header("X-Thread-Id") || c.req.query("threadId");
    const userId = c.req.header("X-User-Id") || c.req.query("userId");

    const result = await rateLimiter.checkLimit(
      {
        ip,
        threadId,
        userId,
        endpoint,
      },
      config,
    );

    // Set rate limit headers
    c.header("X-RateLimit-Limit", result.limit.toString());
    c.header("X-RateLimit-Remaining", result.remaining.toString());
    c.header("X-RateLimit-Reset", result.resetTime.toString());

    if (!result.allowed) {
      c.header("Retry-After", (result.retryAfter || 60).toString());
      return c.json(
        {
          error: "Rate limit exceeded",
          retryAfter: result.retryAfter,
        },
        429,
      );
    }

    await next();
  };
}
