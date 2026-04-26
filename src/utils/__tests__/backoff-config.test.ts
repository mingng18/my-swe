import { describe, it, expect, beforeEach } from "bun:test";
import { loadTelegramBackoffConfig } from "../config";

describe("loadTelegramBackoffConfig", () => {
  // Store original env values
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset env before each test
    process.env = { ...originalEnv };
    // Clear the specific env vars we're testing
    delete process.env.TELEGRAM_BACKOFF_BASE_MS;
    delete process.env.TELEGRAM_BACKOFF_MAX_MS;
  });

  describe("default values", () => {
    it("should use default baseDelayMs of 1000ms when env var not set", () => {
      const config = loadTelegramBackoffConfig();
      expect(config.baseDelayMs).toBe(1000);
    });

    it("should use default maxDelayMs of 60000ms when env var not set", () => {
      const config = loadTelegramBackoffConfig();
      expect(config.maxDelayMs).toBe(60000);
    });
  });

  describe("custom values from environment", () => {
    it("should respect custom TELEGRAM_BACKOFF_BASE_MS value", () => {
      process.env.TELEGRAM_BACKOFF_BASE_MS = "5000";
      const config = loadTelegramBackoffConfig();
      expect(config.baseDelayMs).toBe(5000);
    });

    it("should respect custom TELEGRAM_BACKOFF_MAX_MS value", () => {
      process.env.TELEGRAM_BACKOFF_MAX_MS = "120000";
      const config = loadTelegramBackoffConfig();
      expect(config.maxDelayMs).toBe(120000);
    });

    it("should handle both custom values simultaneously", () => {
      process.env.TELEGRAM_BACKOFF_BASE_MS = "2000";
      process.env.TELEGRAM_BACKOFF_MAX_MS = "30000";
      const config = loadTelegramBackoffConfig();
      expect(config.baseDelayMs).toBe(2000);
      expect(config.maxDelayMs).toBe(30000);
    });
  });

  describe("validation", () => {
    it("should reject negative baseDelayMs", () => {
      process.env.TELEGRAM_BACKOFF_BASE_MS = "-100";
      expect(() => loadTelegramBackoffConfig()).toThrow(
        "TELEGRAM_BACKOFF_BASE_MS must be a non-negative number"
      );
    });

    it("should reject maxDelayMs less than baseDelayMs", () => {
      process.env.TELEGRAM_BACKOFF_BASE_MS = "10000";
      process.env.TELEGRAM_BACKOFF_MAX_MS = "5000";
      expect(() => loadTelegramBackoffConfig()).toThrow(
        "TELEGRAM_BACKOFF_MAX_MS must be greater than or equal to TELEGRAM_BACKOFF_BASE_MS"
      );
    });

    it("should allow maxDelayMs equal to baseDelayMs", () => {
      process.env.TELEGRAM_BACKOFF_BASE_MS = "5000";
      process.env.TELEGRAM_BACKOFF_MAX_MS = "5000";
      const config = loadTelegramBackoffConfig();
      expect(config.baseDelayMs).toBe(5000);
      expect(config.maxDelayMs).toBe(5000);
    });

    it("should handle zero as valid baseDelayMs", () => {
      process.env.TELEGRAM_BACKOFF_BASE_MS = "0";
      const config = loadTelegramBackoffConfig();
      expect(config.baseDelayMs).toBe(0);
    });

    it("should handle invalid input by falling back to default", () => {
      process.env.TELEGRAM_BACKOFF_BASE_MS = "invalid";
      const config = loadTelegramBackoffConfig();
      expect(config.baseDelayMs).toBe(1000); // Falls back to default
    });

    it("should handle empty string by falling back to default", () => {
      process.env.TELEGRAM_BACKOFF_BASE_MS = "";
      const config = loadTelegramBackoffConfig();
      expect(config.baseDelayMs).toBe(1000); // Falls back to default
    });
  });

  describe("integration with exponential backoff", () => {
    it("should produce correct backoff calculations with custom config", () => {
      // Set custom values
      process.env.TELEGRAM_BACKOFF_BASE_MS = "2000";
      process.env.TELEGRAM_BACKOFF_MAX_MS = "20000";

      const config = loadTelegramBackoffConfig();

      // Simulate exponential backoff calculations
      const attempt1Delay = Math.min(
        config.baseDelayMs * Math.pow(2, 0),
        config.maxDelayMs
      );
      const attempt2Delay = Math.min(
        config.baseDelayMs * Math.pow(2, 1),
        config.maxDelayMs
      );
      const attempt3Delay = Math.min(
        config.baseDelayMs * Math.pow(2, 2),
        config.maxDelayMs
      );
      const attempt4Delay = Math.min(
        config.baseDelayMs * Math.pow(2, 3),
        config.maxDelayMs
      );
      const attempt5Delay = Math.min(
        config.baseDelayMs * Math.pow(2, 4),
        config.maxDelayMs
      );

      // Verify exponential growth with max cap
      expect(attempt1Delay).toBe(2000);
      expect(attempt2Delay).toBe(4000);
      expect(attempt3Delay).toBe(8000);
      expect(attempt4Delay).toBe(16000);
      expect(attempt5Delay).toBe(20000); // Capped at maxDelayMs
    });

    it("should handle aggressive backoff configuration", () => {
      // Very short base delay for fast retries
      process.env.TELEGRAM_BACKOFF_BASE_MS = "100";
      process.env.TELEGRAM_BACKOFF_MAX_MS = "5000";

      const config = loadTelegramBackoffConfig();

      // Verify the aggressive config is loaded
      expect(config.baseDelayMs).toBe(100);
      expect(config.maxDelayMs).toBe(5000);

      // First retry should be very fast
      const attempt1Delay = Math.min(
        config.baseDelayMs * Math.pow(2, 0),
        config.maxDelayMs
      );
      expect(attempt1Delay).toBe(100);
    });

    it("should handle conservative backoff configuration", () => {
      // Long base delay for slower retries
      process.env.TELEGRAM_BACKOFF_BASE_MS = "5000";
      process.env.TELEGRAM_BACKOFF_MAX_MS = "300000"; // 5 minutes

      const config = loadTelegramBackoffConfig();

      // Verify the conservative config is loaded
      expect(config.baseDelayMs).toBe(5000);
      expect(config.maxDelayMs).toBe(300000);

      // First retry should be slower
      const attempt1Delay = Math.min(
        config.baseDelayMs * Math.pow(2, 0),
        config.maxDelayMs
      );
      expect(attempt1Delay).toBe(5000);
    });
  });
});
