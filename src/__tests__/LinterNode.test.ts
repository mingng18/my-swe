import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";

// Mock the dependencies
mock.module("../memory/repository", () => ({
  MemoryRepository: class MockMemoryRepository {
    saveBatch = mock();
    getByThread = mock().mockResolvedValue([]);
    getByThreads = mock().mockResolvedValue([]);
    save = mock().mockResolvedValue({});
    update = mock().mockResolvedValue({});
  }
}));
mock.module("../memory/extractor", () => ({
  MemoryExtractor: class MockMemoryExtractor {
    extractMemories = mock();
    extractFromTurn = mock().mockReturnValue([]);
  }
}));
mock.module("../memory/embeddings", () => ({
  EmbeddingService: class MockEmbeddingService {
    embed = mock();
    generateEmbedding = mock().mockResolvedValue([0.1, 0.2]);
    generateEmbeddingsBatch = mock().mockResolvedValue([]);
    cosineSimilarity = mock().mockReturnValue(1);
  }
}));

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
