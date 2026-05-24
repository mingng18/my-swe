import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";

// Mock the dependencies
mock.module("../memory/repository", () => {
  return {
    MemoryRepository: class MockMemoryRepository {
      saveBatch = mock();
    }
  };
});
mock.module("../memory/extractor", () => {
  return {
    MemoryExtractor: class MockMemoryExtractor {
      extractFromTurn = mock();
    }
  };
});
mock.module("../memory/embeddings", () => {
  return {
    EmbeddingService: class MockEmbeddingService {
      embed = mock();
    }
  };
});

import { isMemoryEnabled, initializeMemoryServices } from "../nodes/deterministic/LinterNode";

describe("LinterNode memory services", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Save original environment
    process.env = { ...originalEnv };
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
