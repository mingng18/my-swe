import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import {
  retryWithBackoff,
  calculateBackoff,
  sleep,
  createRetryFn,
  loadRetryConfig,
  DEFAULT_RETRY_CONFIG,
  formatRetryAttempts,
  type RetryConfig,
  type RetryResult,
  type RetryAttempt,
} from "../retry";

describe("retryWithBackoff", () => {
  test("should succeed on first attempt", async () => {
    const mockFn = mock(async (attempt: number) => {
      return `success-${attempt}`;
    });

    const result = await retryWithBackoff(mockFn);

    expect(result.success).toBe(true);
    expect(result.value).toBe("success-0");
    expect(result.attempts).toBe(1);
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  test("should retry on failure and eventually succeed", async () => {
    let callCount = 0;
    const mockFn = mock(async (attempt: number) => {
      callCount++;
      if (callCount < 3) {
        throw new Error(`Attempt ${attempt} failed`);
      }
      return `success-${attempt}`;
    });

    const result = await retryWithBackoff(mockFn, {
      maxRetries: 5,
      initialDelayMs: 10,
    });

    expect(result.success).toBe(true);
    expect(result.value).toBe("success-2");
    expect(result.attempts).toBe(3);
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  test("should exhaust retries and return failure", async () => {
    const mockFn = mock(async (attempt: number) => {
      throw new Error(`Attempt ${attempt} failed`);
    });

    const result = await retryWithBackoff(mockFn, {
      maxRetries: 2,
      initialDelayMs: 10,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.message).toBe("Attempt 2 failed");
    expect(result.attempts).toBe(3); // initial + 2 retries
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  test("should call onRetry callback for each retry", async () => {
    const mockFn = mock(async (attempt: number) => {
      throw new Error(`Failed ${attempt}`);
    });

    const retryCallback = mock((attempt: RetryAttempt) => {
      expect(attempt.success).toBe(false);
      expect(attempt.error).toBeDefined();
    });

    await retryWithBackoff(
      mockFn,
      { maxRetries: 2, initialDelayMs: 10 },
      retryCallback,
    );

    expect(retryCallback).toHaveBeenCalledTimes(3); // 3 total attempts = 3 callbacks
  });

  test("should not call onRetry on success", async () => {
    const mockFn = mock(async (attempt: number) => {
      if (attempt === 0) {
        throw new Error("First attempt fails");
      }
      return `success-${attempt}`;
    });

    const retryCallback = mock();

    const result = await retryWithBackoff(
      mockFn,
      { maxRetries: 3, initialDelayMs: 10 },
      retryCallback,
    );

    expect(result.success).toBe(true);
    expect(retryCallback).toHaveBeenCalledTimes(1); // Only called once after first failure
  });

  test("should track total duration", async () => {
    const mockFn = mock(async (attempt: number) => {
      if (attempt < 2) {
        throw new Error("Fail");
      }
      return "success";
    });

    const result = await retryWithBackoff(mockFn, {
      maxRetries: 5,
      initialDelayMs: 50,
    });

    expect(result.success).toBe(true);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    // Should have taken at least 50ms (one delay of ~50ms)
    expect(result.totalDurationMs).toBeGreaterThan(40);
  });

  test("should handle zero retries", async () => {
    const mockFn = mock(async (attempt: number) => {
      throw new Error("Failed");
    });

    const result = await retryWithBackoff(mockFn, {
      maxRetries: 0,
      initialDelayMs: 10,
    });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1); // Only initial attempt
    expect(mockFn).toHaveBeenCalledTimes(1);
  });
});

describe("calculateBackoff", () => {
  test("should calculate exponential backoff correctly", () => {
    const config: RetryConfig = {
      initialDelayMs: 1000,
      maxDelayMs: 60000,
      backoffBase: 2,
      maxRetries: 3,
    };

    // Due to jitter, we can't test exact values, but we can test ranges
    // Attempt 0: 1000 * 2^0 = 1000, so delay should be in [0, 1000]
    const delay0 = calculateBackoff(0, config);
    expect(delay0).toBeGreaterThanOrEqual(0);
    expect(delay0).toBeLessThanOrEqual(1000);

    // Attempt 1: 1000 * 2^1 = 2000, so delay should be in [0, 2000]
    const delay1 = calculateBackoff(1, config);
    expect(delay1).toBeGreaterThanOrEqual(0);
    expect(delay1).toBeLessThanOrEqual(2000);

    // Attempt 2: 1000 * 2^2 = 4000, so delay should be in [0, 4000]
    const delay2 = calculateBackoff(2, config);
    expect(delay2).toBeGreaterThanOrEqual(0);
    expect(delay2).toBeLessThanOrEqual(4000);
  });

  test("should cap at maxDelayMs", () => {
    const config: RetryConfig = {
      initialDelayMs: 1000,
      maxDelayMs: 100,
      backoffBase: 10,
      maxRetries: 3,
    };

    // With huge backoff base, delay should still be capped at maxDelayMs
    const delay = calculateBackoff(5, config);
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThanOrEqual(100);
  });

  test("should use default config when not provided", () => {
    const delay = calculateBackoff(1);
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThanOrEqual(DEFAULT_RETRY_CONFIG.maxDelayMs);
  });
});

describe("sleep", () => {
  test("should sleep for specified duration", async () => {
    const start = Date.now();
    await sleep(50);
    const end = Date.now();

    const duration = end - start;
    expect(duration).toBeGreaterThanOrEqual(45); // Allow small margin
    expect(duration).toBeLessThan(100); // Should not be much longer
  });

  test("should handle zero delay", async () => {
    const start = Date.now();
    await sleep(0);
    const end = Date.now();

    const duration = end - start;
    expect(duration).toBeLessThan(10); // Should be nearly instant
  });
});

describe("createRetryFn", () => {
  test("should create a reusable retry function", async () => {
    const retryWithSpecificConfig = createRetryFn({
      maxRetries: 2,
      initialDelayMs: 10,
    });

    const mockFn1 = mock(async () => "result1");
    const result1 = await retryWithSpecificConfig(mockFn1);

    expect(result1.success).toBe(true);
    expect(result1.value).toBe("result1");

    const mockFn2 = mock(async () => {
      throw new Error("Failed");
    });
    const result2 = await retryWithSpecificConfig(mockFn2);

    expect(result2.success).toBe(false);
    expect(result2.attempts).toBe(3); // initial + 2 retries
  });

  test("should pass onRetry callback to created function", async () => {
    const retryCallback = mock();

    const retryFn = createRetryFn(
      { maxRetries: 2, initialDelayMs: 10 },
      retryCallback,
    );

    const mockFn = mock(async () => {
      throw new Error("Failed");
    });

    await retryFn(mockFn);

    expect(retryCallback).toHaveBeenCalledTimes(3); // 3 total attempts = 3 callbacks
  });
});

describe("loadRetryConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("should load default values when env vars not set", () => {
    delete process.env.TELEGRAM_BACKOFF_INITIAL_MS;
    delete process.env.TELEGRAM_BACKOFF_MAX_MS;
    delete process.env.TELEGRAM_BACKOFF_BASE;
    delete process.env.TELEGRAM_BACKOFF_MAX_RETRIES;

    const config = loadRetryConfig();

    expect(config.initialDelayMs).toBe(1000);
    expect(config.maxDelayMs).toBe(60000);
    expect(config.backoffBase).toBe(2);
    expect(config.maxRetries).toBe(3);
  });

  test("should load values from environment variables", () => {
    process.env.TELEGRAM_BACKOFF_INITIAL_MS = "2000";
    process.env.TELEGRAM_BACKOFF_MAX_MS = "120000";
    process.env.TELEGRAM_BACKOFF_BASE = "3";
    process.env.TELEGRAM_BACKOFF_MAX_RETRIES = "5";

    const config = loadRetryConfig();

    expect(config.initialDelayMs).toBe(2000);
    expect(config.maxDelayMs).toBe(120000);
    expect(config.backoffBase).toBe(3);
    expect(config.maxRetries).toBe(5);
  });

  test("should handle invalid environment variables gracefully", () => {
    process.env.TELEGRAM_BACKOFF_INITIAL_MS = "invalid";
    process.env.TELEGRAM_BACKOFF_MAX_MS = "invalid";
    process.env.TELEGRAM_BACKOFF_BASE = "invalid";
    process.env.TELEGRAM_BACKOFF_MAX_RETRIES = "invalid";

    const config = loadRetryConfig();

    // parseInt and parseFloat return NaN for invalid strings
    expect(config.initialDelayMs).toBeNaN();
    expect(config.maxDelayMs).toBeNaN();
    expect(config.backoffBase).toBeNaN();
    expect(config.maxRetries).toBeNaN();
  });
});

describe("formatRetryAttempts", () => {
  test("should return message for empty attempts", () => {
    const result = formatRetryAttempts([]);
    expect(result).toBe("No attempts made");
  });

  test("should format successful attempts", () => {
    const attempts: RetryAttempt[] = [
      {
        attemptNumber: 0,
        success: true,
        delayMs: 0,
        timestamp: new Date(),
      },
    ];

    const result = formatRetryAttempts(attempts);

    expect(result).toContain("Retry attempts: 1");
    expect(result).toContain("✓");
    expect(result).toContain("success");
  });

  test("should format failed attempts with error", () => {
    const attempts: RetryAttempt[] = [
      {
        attemptNumber: 0,
        success: false,
        delayMs: 100,
        error: new Error("Test error"),
        timestamp: new Date(),
      },
    ];

    const result = formatRetryAttempts(attempts);

    expect(result).toContain("Retry attempts: 1");
    expect(result).toContain("✗");
    expect(result).toContain("failed");
    expect(result).toContain("delay: 100ms");
    expect(result).toContain("Test error");
  });

  test("should format mixed attempts", () => {
    const attempts: RetryAttempt[] = [
      {
        attemptNumber: 0,
        success: false,
        delayMs: 0,
        error: new Error("First failure"),
        timestamp: new Date(),
      },
      {
        attemptNumber: 1,
        success: false,
        delayMs: 1000,
        error: new Error("Second failure"),
        timestamp: new Date(),
      },
      {
        attemptNumber: 2,
        success: true,
        delayMs: 2000,
        timestamp: new Date(),
      },
    ];

    const result = formatRetryAttempts(attempts);

    expect(result).toContain("Retry attempts: 3");
    expect(result).toContain("✗ Attempt 1: failed");
    expect(result).toContain("✗ Attempt 2: failed (delay: 1000ms)");
    expect(result).toContain("✓ Attempt 3: success (delay: 2000ms)");
  });
});

describe("integration tests", () => {
  test("should handle real-world scenario with exponential backoff", async () => {
    let attemptCount = 0;
    const mockFn = mock(async (attempt: number) => {
      attemptCount++;
      if (attemptCount < 4) {
        throw new Error(`API rate limited`);
      }
      return { data: "success" };
    });

    const result = await retryWithBackoff(mockFn, {
      initialDelayMs: 50,
      maxDelayMs: 200,
      maxRetries: 5,
    });

    expect(result.success).toBe(true);
    expect(result.value).toEqual({ data: "success" });
    expect(result.attempts).toBe(4);
  });

  test("should preserve error types through retries", async () => {
    class CustomError extends Error {
      constructor(message: string, public code: string) {
        super(message);
        this.name = "CustomError";
      }
    }

    const mockFn = mock(async () => {
      throw new CustomError("Something went wrong", "ERR_CODE");
    });

    const result = await retryWithBackoff(mockFn, {
      maxRetries: 1,
      initialDelayMs: 10,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(CustomError);
    expect((result.error as CustomError).code).toBe("ERR_CODE");
  });
});
