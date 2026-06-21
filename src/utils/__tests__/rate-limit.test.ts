import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  setSystemTime,
} from "bun:test";
import { MultiDimensionalRateLimiter } from "../rate-limit";

describe("MultiDimensionalRateLimiter", () => {
  let limiter: MultiDimensionalRateLimiter;
  const initialTime = new Date("2025-01-01T00:00:00Z").getTime();
  const config = {
    perMinute: 5,
    perHour: 20,
    perThread: 3,
    perUser: 2,
  };

  const baseKey = {
    ip: "127.0.0.1",
    endpoint: "/api/chat",
  };

  beforeEach(() => {
    limiter = new MultiDimensionalRateLimiter();
    setSystemTime(initialTime);
  });

  afterEach(() => {
    limiter.clearAll();
    setSystemTime(); // reset to real time
  });

  it("should allow requests under the limit", async () => {
    const res = await limiter.checkLimit(baseKey, config);
    expect(res.allowed).toBe(true);
    expect(res.limit).toBe(5);
    expect(res.remaining).toBe(4);
    expect(res.resetTime).toBe(initialTime + 60000);
  });

  it("should block requests exceeding per-minute limit", async () => {
    for (let i = 0; i < config.perMinute; i++) {
      const res = await limiter.checkLimit(baseKey, config);
      expect(res.allowed).toBe(true);
    }

    const blockedRes = await limiter.checkLimit(baseKey, config);
    expect(blockedRes.allowed).toBe(false);
    expect(blockedRes.retryAfter).toBe(60);
    expect(blockedRes.remaining).toBe(0);
  });

  it("should allow requests after minute window expires", async () => {
    for (let i = 0; i < config.perMinute; i++) {
      await limiter.checkLimit(baseKey, config);
    }

    // Fast-forward 61 seconds
    setSystemTime(initialTime + 61000);

    const newRes = await limiter.checkLimit(baseKey, config);
    expect(newRes.allowed).toBe(true);
  });

  it("should block requests exceeding per-hour limit", async () => {
    // We send max per minute requests, advance time slightly over a minute, and repeat until hourly limit is reached
    let currentTime = initialTime;

    // The perHour limit is 20. We send 5 requests per minute, so we can do this for 4 minutes.
    for (let minute = 0; minute < 4; minute++) {
      setSystemTime(currentTime);
      for (let i = 0; i < config.perMinute; i++) {
        const res = await limiter.checkLimit(baseKey, config);
        expect(res.allowed).toBe(true);
      }
      currentTime += 61000; // advance 61 seconds
    }

    // Now we've sent 20 requests (in less than an hour). The 21st should be blocked by perHour
    setSystemTime(currentTime);
    const blockedRes = await limiter.checkLimit(baseKey, config);
    expect(blockedRes.allowed).toBe(false);
    expect(blockedRes.retryAfter).toBe(3600);
    expect(blockedRes.remaining).toBe(0);
  });

  it("should enforce per-thread limit", async () => {
    const threadKey = { ...baseKey, threadId: "thread-123" };

    for (let i = 0; i < config.perThread; i++) {
      const res = await limiter.checkLimit(threadKey, config);
      expect(res.allowed).toBe(true);
    }

    // Next request on same thread should be blocked
    const blockedRes = await limiter.checkLimit(threadKey, config);
    expect(blockedRes.allowed).toBe(false);

    // Request on another thread should be allowed
    const otherThreadKey = { ...baseKey, threadId: "thread-456" };
    const allowedRes = await limiter.checkLimit(otherThreadKey, config);
    expect(allowedRes.allowed).toBe(true);
  });

  it("should enforce per-user limit", async () => {
    const userKey = { ...baseKey, userId: "user-123" };

    for (let i = 0; i < config.perUser; i++) {
      const res = await limiter.checkLimit(userKey, config);
      expect(res.allowed).toBe(true);
    }

    // Next request from same user should be blocked
    const blockedRes = await limiter.checkLimit(userKey, config);
    expect(blockedRes.allowed).toBe(false);

    // Request from another user should be allowed
    const otherUserKey = { ...baseKey, userId: "user-456" };
    const allowedRes = await limiter.checkLimit(otherUserKey, config);
    expect(allowedRes.allowed).toBe(true);
  });

  it("should return correct stats", async () => {
    await limiter.checkLimit(baseKey, config);
    await limiter.checkLimit(baseKey, config);

    const stats = limiter.getStats(baseKey);
    expect(stats.minuteCount).toBe(2);
    expect(stats.hourCount).toBe(2);
    expect(stats.windowSize).toBe(2);

    // Advance 61 seconds
    setSystemTime(initialTime + 61000);

    await limiter.checkLimit(baseKey, config);

    const newStats = limiter.getStats(baseKey);
    expect(newStats.minuteCount).toBe(1);
    expect(newStats.hourCount).toBe(3);
    expect(newStats.windowSize).toBe(3);
  });

  it("should clear specific key", async () => {
    for (let i = 0; i < config.perMinute; i++) {
      await limiter.checkLimit(baseKey, config);
    }

    let res = await limiter.checkLimit(baseKey, config);
    expect(res.allowed).toBe(false);

    limiter.clear(baseKey);

    res = await limiter.checkLimit(baseKey, config);
    expect(res.allowed).toBe(true);
  });
});
