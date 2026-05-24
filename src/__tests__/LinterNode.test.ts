import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";

// Mock the dependencies

import { isMemoryEnabled, initializeMemoryServices } from "../nodes/deterministic/LinterNode";

describe("LinterNode memory services", () => {
  const originalEnv = process.env;

      beforeEach(() => {
    // Save original environment
    process.env = { ...originalEnv };
    process.env.SUPABASE_URL = "http://test.com";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
    process.env.OPENAI_API_KEY = "test";
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    // Reset memory services by disabling it and initializing
    process.env.MEMORY_ENABLED = "false";
    initializeMemoryServices();
  });

  describe("isMemoryEnabled", () => {
    it("should return false when MEMORY_ENABLED is not 'true'", () => {
      process.env.MEMORY_ENABLED = "false";
      expect(isMemoryEnabled()).toBe(false);

      delete process.env.MEMORY_ENABLED;
      expect(isMemoryEnabled()).toBe(false);
    });

    it("should return false when MEMORY_ENABLED is 'true' but memoryRepository is null", () => {
      process.env.MEMORY_ENABLED = "true";
      // memoryRepository starts as null before initializeMemoryServices is called with MEMORY_ENABLED="true"
      // we make sure we reset it to null in afterEach
      expect(isMemoryEnabled()).toBe(false);
    });

    it("should return true when MEMORY_ENABLED is 'true' and initializeMemoryServices has been called", () => {
      process.env.MEMORY_ENABLED = "true";
      initializeMemoryServices();

      expect(isMemoryEnabled()).toBe(true);
    });
  });
});
