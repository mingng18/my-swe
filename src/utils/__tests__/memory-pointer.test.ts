import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  storeArtifact,
  retrieveArtifact,
  queryArtifact,
  listArtifacts,
  deleteArtifact,
  cleanupArtifacts,
  shouldStoreAsPointer,
  type ArtifactMetadata,
} from "../memory-pointer";

const TEST_THREAD_ID = "test-thread-memory-pointer";
const MEMORY_POINTER_DIR = process.env.MEMORY_POINTER_DIR || ".memory-pointers";

describe("Memory Pointer", () => {
  beforeAll(async () => {
    // Clean up any existing test artifacts
    await cleanupArtifacts(TEST_THREAD_ID);
  });

  afterAll(async () => {
    // Clean up after tests
    await cleanupArtifacts(TEST_THREAD_ID);
  });

  describe("shouldStoreAsPointer", () => {
    it("should return false for small content", () => {
      const smallContent = "small text";
      expect(shouldStoreAsPointer(smallContent)).toBe(false);
    });

    it("should return true for large content", () => {
      const largeContent = "x".repeat(20001); // > 5000 tokens (~4 chars per token)
      expect(shouldStoreAsPointer(largeContent)).toBe(true);
    });
  });

  describe("storeArtifact", () => {
    it("should store large artifacts and return pointer ID", async () => {
      // Use content well above the 5000 token threshold
      const largeContent = "x".repeat(25000); // ~6250 tokens

      const pointerId = await storeArtifact(
        TEST_THREAD_ID,
        "test-artifact",
        largeContent,
        { test: true },
      );

      expect(pointerId).not.toBeNull();
      expect(pointerId).toMatch(/^ptr_/);
    });

    it("should return null for small artifacts", async () => {
      const smallContent = "small content";

      const pointerId = await storeArtifact(
        TEST_THREAD_ID,
        "test-artifact-small",
        smallContent,
      );

      expect(pointerId).toBeNull();
    });
  });

  describe("retrieveArtifact", () => {
    it("should retrieve stored artifact", async () => {
      const content = "x".repeat(25000); // Well above threshold
      const pointerId = await storeArtifact(
        TEST_THREAD_ID,
        "test-retrieve",
        content,
        { key: "value" },
      );

      expect(pointerId).not.toBeNull();

      const artifact = await retrieveArtifact(pointerId!, TEST_THREAD_ID);
      expect(artifact).not.toBeNull();
      expect(artifact!.content).toBe(content);
      expect(artifact!.metadata.type).toBe("test-retrieve");
      expect(artifact!.metadata.metadata.key).toBe("value");
    });

    it("should return null for wrong thread", async () => {
      const content = "x".repeat(25000);
      const pointerId = await storeArtifact(
        TEST_THREAD_ID,
        "test-thread-security",
        content,
      );

      expect(pointerId).not.toBeNull();

      const artifact = await retrieveArtifact(pointerId!, "wrong-thread-id");
      expect(artifact).toBeNull();
    });
  });

  describe("queryArtifact", () => {
    it("should query full artifact", async () => {
      const content = "x".repeat(25000);
      const pointerId = await storeArtifact(
        TEST_THREAD_ID,
        "test-query-full",
        content,
      );

      expect(pointerId).not.toBeNull();

      const result = await queryArtifact(pointerId!, TEST_THREAD_ID, {
        type: "full",
      });

      expect(result).not.toBeNull();
      expect(result!.content).toBe(content);
      expect(result!.truncated).toBe(false);
    });

    it("should query line range", async () => {
      // Create multi-line content (200 lines of 125 chars each = 25000 chars total)
      const lines = Array.from(
        { length: 200 },
        (_, i) => `line ${i} ${"x".repeat(100)}`,
      );
      const content = lines.join("\n");
      const pointerId = await storeArtifact(
        TEST_THREAD_ID,
        "test-query-range",
        content,
      );

      expect(pointerId).not.toBeNull();

      const result = await queryArtifact(pointerId!, TEST_THREAD_ID, {
        type: "line-range",
        startLine: 1,
        endLine: 10,
      });

      expect(result).not.toBeNull();
      // Should return 10 lines
      expect(result!.content.split("\n").length).toBe(10);
    });

    it("should query with grep pattern", async () => {
      // Create content large enough to exceed 5000 token threshold
      // 600 lines * ~35 chars = 21000 chars = 5250 tokens
      const lines = Array.from({ length: 600 }, (_, i) =>
        i % 5 === 0
          ? "MATCH line content here with more text to ensure we exceed threshold"
          : "other line content here with more text to ensure we exceed threshold",
      );
      const content = lines.join("\n");
      const pointerId = await storeArtifact(
        TEST_THREAD_ID,
        "test-query-grep",
        content,
      );

      expect(pointerId).not.toBeNull();

      const result = await queryArtifact(pointerId!, TEST_THREAD_ID, {
        type: "grep",
        pattern: "MATCH",
      });

      expect(result).not.toBeNull();
      expect(result!.content).toContain("MATCH");
    });

    it("should return summary", async () => {
      // Create enough content to exceed 5000 token threshold (600 lines)
      const lines = Array.from(
        { length: 600 },
        (_, i) => `line ${i} ${"x".repeat(80)}`,
      );
      const content = lines.join("\n");
      const pointerId = await storeArtifact(
        TEST_THREAD_ID,
        "test-query-summary",
        content,
      );

      expect(pointerId).not.toBeNull();

      const result = await queryArtifact(pointerId!, TEST_THREAD_ID, {
        type: "summary",
      });

      expect(result).not.toBeNull();
      expect(result!.truncated).toBe(true);
      expect(result!.content).toContain("omitted");
    });
  });

  describe("listArtifacts", () => {
    it("should list artifacts for thread", async () => {
      // Create a few artifacts with content well above threshold
      await storeArtifact(TEST_THREAD_ID, "test-list-1", "x".repeat(25000));
      await storeArtifact(TEST_THREAD_ID, "test-list-2", "y".repeat(25000));

      const artifacts = await listArtifacts(TEST_THREAD_ID);

      // Filter for our test artifacts
      const testArtifacts = artifacts.filter((a) =>
        a.type.startsWith("test-list"),
      );

      expect(testArtifacts.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("deleteArtifact", () => {
    it("should delete artifact", async () => {
      const pointerId = await storeArtifact(
        TEST_THREAD_ID,
        "test-delete",
        "x".repeat(25000),
      );

      expect(pointerId).not.toBeNull();

      await deleteArtifact(pointerId!);

      const artifact = await retrieveArtifact(pointerId!, TEST_THREAD_ID);
      expect(artifact).toBeNull();
    });
  });
});
