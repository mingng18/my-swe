import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { isMemoryEnabled, initializeMemoryServices } from "../nodes/deterministic/LinterNode";

// Instead of mock.module which replaces it globally, we don't mock it at all because this file
// only tests isMemoryEnabled, which doesn't call any memory methods, just checks if they instantiate!

describe("LinterNode memory services", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
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
      expect(isMemoryEnabled()).toBe(false);
    });

    it("should return true when MEMORY_ENABLED is 'true' and initializeMemoryServices has been called", () => {
      process.env.MEMORY_ENABLED = "true";
      // To prevent real connection to Supabase during tests if initializeMemoryServices is called
      // we'll just temporarily set dummy env vars for init.
      process.env.SUPABASE_URL = "http://localhost:1234";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy";
      process.env.OPENAI_API_KEY = "dummy";

      initializeMemoryServices();
      expect(isMemoryEnabled()).toBe(true);
    });
  });
});
