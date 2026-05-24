import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  isMemoryEnabled,
  initializeMemoryServices,
  resetMemoryServicesForTests,
} from "../nodes/deterministic/LinterNode";

describe("LinterNode memory services", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetMemoryServicesForTests();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    resetMemoryServicesForTests();
    process.env = originalEnv;
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
      process.env.SUPABASE_URL = "http://test.example";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
      initializeMemoryServices();

      expect(isMemoryEnabled()).toBe(true);
    });
  });
});
