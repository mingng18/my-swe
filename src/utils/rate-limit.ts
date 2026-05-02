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
    const oneHourAgo = now - 3600000;
    timestamps = timestamps.filter((t) => t > oneHourAgo);
    this.windows.set(keyStr, timestamps);

    // Check per-minute limit
    const oneMinuteAgo = now - 60000;
    const recentMinute = timestamps.filter((t) => t > oneMinuteAgo);

    if (recentMinute.length >= config.perMinute) {
      logger.warn(
        { ip: key.ip, endpoint: key.endpoint, limit: config.perMinute },
        "[rate-limit] Per-minute limit exceeded",
      );

      return {
        allowed: false,
        retryAfter: 60,
        limit: config.perMinute,
        remaining: 0,
        resetTime: this.getNextResetTime(recentMinute, 60000),
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
      const recentThreadMinute = threadTimestamps.filter((t) => t > oneMinuteAgo);

      if (recentThreadMinute.length >= config.perThread) {
        logger.warn(
          { ip: key.ip, threadId: key.threadId, endpoint: key.endpoint, limit: config.perThread },
          "[rate-limit] Per-thread limit exceeded",
        );

        return {
          allowed: false,
          retryAfter: 60,
          limit: config.perThread,
          remaining: 0,
          resetTime: this.getNextResetTime(recentThreadMinute, 60000),
        };
      }
    }

    // Check per-user limit (if specified)
    if (config.perUser && key.userId) {
      const userKey = this.serializeKey({ ...key, endpoint: `${key.endpoint}:user` });
      const userTimestamps = this.windows.get(userKey) || [];
      const recentUserMinute = userTimestamps.filter((t) => t > oneMinuteAgo);

      if (recentUserMinute.length >= config.perUser) {
        logger.warn(
          { ip: key.ip, userId: key.userId, endpoint: key.endpoint, limit: config.perUser },
          "[rate-limit] Per-user limit exceeded",
        );

        return {
          allowed: false,
          retryAfter: 60,
          limit: config.perUser,
          remaining: 0,
          resetTime: this.getNextResetTime(recentUserMinute, 60000),
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
      remaining: config.perMinute - recentMinute.length - 1,
      resetTime: this.getNextResetTime(recentMinute, 60000),
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

    const minuteCount = timestamps.filter((t) => t > oneMinuteAgo).length;
    const hourCount = timestamps.filter((t) => t > oneHourAgo).length;

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

    const oldestTimestamp = Math.min(...timestamps);
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
