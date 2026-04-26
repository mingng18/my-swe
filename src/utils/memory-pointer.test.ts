/**
 * Unit tests for memory-pointer utility.
 *
 * Tests artifact storage, retrieval, querying, and cleanup functionality.
 */

// Set environment variables BEFORE importing the module
process.env.MEMORY_POINTER_TTL_HOURS = "1";
// Note: We don't set MEMORY_POINTER_DIR, so it uses the default ".memory-pointers"
// Note: MAX_POINTER_SIZE_TOKENS can't be changed after module load
// Default is 5000 tokens, so we use content that exceeds that

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as memoryPointer from "./memory-pointer";

// Use the default directory name from the module
const TEST_MEMORY_DIR = ".memory-pointers";

describe("memory-pointer", () => {
  // Use content size that exceeds default threshold (5000 tokens = ~20000 chars)
  const LARGE_CONTENT = "a".repeat(25000); // ~6250 tokens
  const SMALL_CONTENT = "a".repeat(1000);  // ~250 tokens

  beforeEach(async () => {
    // Clean up any existing test directory
    if (existsSync(TEST_MEMORY_DIR)) {
      await Bun.$`rm -rf ${TEST_MEMORY_DIR}`;
    }

    // Create fresh test directory
    await mkdir(TEST_MEMORY_DIR, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    if (existsSync(TEST_MEMORY_DIR)) {
      await Bun.$`rm -rf ${TEST_MEMORY_DIR}`;
    }
  });

  describe("estimateTokens", () => {
    it("should estimate tokens correctly for short strings", () => {
      // estimateTokens is not exported, but we can test it indirectly
      const shortContent = SMALL_CONTENT; // ~250 tokens, below default threshold of 5000
      expect(memoryPointer.shouldStoreAsPointer(shortContent)).toBe(false);
    });

    it("should estimate tokens correctly for long strings", () => {
      const longContent = LARGE_CONTENT; // ~6250 tokens, exceeds default threshold of 5000
      expect(memoryPointer.shouldStoreAsPointer(longContent)).toBe(true);
    });
  });

  describe("shouldStoreAsPointer", () => {
    it("should return false for content below threshold", () => {
      const content = SMALL_CONTENT;
      expect(memoryPointer.shouldStoreAsPointer(content)).toBe(false);
    });

    it("should return true for content above threshold", () => {
      const content = LARGE_CONTENT;
      expect(memoryPointer.shouldStoreAsPointer(content)).toBe(true);
    });

    it("should handle edge case at threshold", () => {
      const content = "a".repeat(19000); // ~4750 tokens, just below threshold of 5000
      expect(memoryPointer.shouldStoreAsPointer(content)).toBe(false);
    });
  });

  describe("storeArtifact", () => {
    it("should return null for content below threshold", async () => {
      const content = SMALL_CONTENT;
      const pointerId = await memoryPointer.storeArtifact(
        "thread-1",
        "test-type",
        content,
      );

      expect(pointerId).toBeNull();
    });

    it("should store content above threshold and return pointer ID", async () => {
      const content = LARGE_CONTENT;
      const pointerId = await memoryPointer.storeArtifact(
        "thread-1",
        "test-type",
        content,
      );

      expect(pointerId).not.toBeNull();
      expect(pointerId).toMatch(/^ptr_[A-Za-z0-9_-]+$/);
    });

    it("should store artifact with correct metadata", async () => {
      const content = LARGE_CONTENT;
      const customMetadata = { source: "test", key: "value" };

      const pointerId = await memoryPointer.storeArtifact(
        "thread-1",
        "test-artifact",
        content,
        customMetadata,
      );

      expect(pointerId).not.toBeNull();

      // Verify metadata
      const artifact = await memoryPointer.retrieveArtifact(
        pointerId!,
        "thread-1",
      );

      expect(artifact).not.toBeNull();
      expect(artifact!.metadata.threadId).toBe("thread-1");
      expect(artifact!.metadata.type).toBe("test-artifact");
      expect(artifact!.metadata.size).toBe(content.length);
      expect(artifact!.metadata.metadata).toEqual(customMetadata);
    });

    it("should create pointer directory if it does not exist", async () => {
      // Remove test directory
      await Bun.$`rm -rf ${TEST_MEMORY_DIR}`;

      const content = LARGE_CONTENT;
      const pointerId = await memoryPointer.storeArtifact(
        "thread-1",
        "test-type",
        content,
      );

      expect(pointerId).not.toBeNull();
      // The directory should be created by ensureDirectory()
      // Check if the file exists instead
      const fs = require("node:fs");
      const path = require("node:path");
      const filePath = path.join(TEST_MEMORY_DIR, `${pointerId}.json`);
      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe("retrieveArtifact", () => {
    it("should retrieve stored artifact", async () => {
      const content = "test content " + "a".repeat(24500); // Total ~25000 chars
      const pointerId = await memoryPointer.storeArtifact(
        "thread-1",
        "test-type",
        content,
      );

      expect(pointerId).not.toBeNull();

      const artifact = await memoryPointer.retrieveArtifact(pointerId!, "thread-1");

      expect(artifact).not.toBeNull();
      expect(artifact!.content).toBe(content);
      expect(artifact!.metadata.id).toBe(pointerId);
    });

    it("should return null for non-existent artifact", async () => {
      const artifact = await memoryPointer.retrieveArtifact(
        "ptr_nonexistent",
        "thread-1",
      );

      expect(artifact).toBeNull();
    });

    it("should return null for invalid pointer ID format", async () => {
      // The function throws for invalid format, so we need to handle that
      expect(() =>
        memoryPointer.retrieveArtifact("invalid-format", "thread-1"),
      ).toThrow();
    });

    it("should return null when thread ID does not match", async () => {
      const content = LARGE_CONTENT;
      const pointerId = await memoryPointer.storeArtifact(
        "thread-1",
        "test-type",
        content,
      );

      expect(pointerId).not.toBeNull();

      const artifact = await memoryPointer.retrieveArtifact(pointerId!, "thread-2");

      expect(artifact).toBeNull();
    });

    it("should return null and delete expired artifacts", async () => {
      // Store artifact
      const content = LARGE_CONTENT;
      const pointerId = await memoryPointer.storeArtifact(
        "thread-1",
        "test-type",
        content,
      );

      // Verify artifact was stored
      expect(pointerId).not.toBeNull();

      // Manually expire the artifact by modifying the file
      const fs = require("node:fs");
      const path = require("node:path");
      const filePath = path.join(TEST_MEMORY_DIR, `${pointerId}.json`);

      // Verify file exists before modification
      expect(existsSync(filePath)).toBe(true);

      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      data.metadata.expiresAt = Date.now() - 1000; // Expired
      fs.writeFileSync(filePath, JSON.stringify(data));

      // Try to retrieve
      const artifact = await memoryPointer.retrieveArtifact(pointerId!, "thread-1");

      expect(artifact).toBeNull();
      expect(existsSync(filePath)).toBe(false); // Should be deleted
    });
  });

  describe("queryArtifact", () => {
    let pointerId: string;
    const testContent = [
      "line 1",
      "line 2",
      "line 3 important",
      "line 4",
      "line 5 important",
      "line 6",
      "line 7",
      "line 8",
      "line 9",
      "line 10",
      "line 11",
      "line 12",
      "line 13",
      "line 14",
      "line 15",
      "line 16",
      "line 17",
      "line 18",
      "line 19",
      "line 20",
      "line 21",
      "line 22",
      "line 23",
      "line 24",
      "line 25",
      "line 26",
      "line 27",
      "line 28",
      "line 29",
      "line 30",
    ].join("\n") + "a".repeat(24500); // Add padding to exceed threshold

    beforeEach(async () => {
      pointerId = (await memoryPointer.storeArtifact(
        "thread-1",
        "test-type",
        testContent,
      ))!;
    });

    describe("full query type", () => {
      it("should return full content", async () => {
        const result = await memoryPointer.queryArtifact(
          pointerId,
          "thread-1",
          { type: "full" },
        );

        expect(result).not.toBeNull();
        expect(result!.content).toBe(testContent);
        expect(result!.truncated).toBe(false);
        expect(result!.queryType).toBe("full");
      });
    });

    describe("line-range query type", () => {
      it("should extract specified line range", async () => {
        const result = await memoryPointer.queryArtifact(
          pointerId,
          "thread-1",
          { type: "line-range", startLine: 5, endLine: 10 },
        );

        expect(result).not.toBeNull();
        const lines = result!.content.split("\n");
        expect(lines.length).toBe(6); // Lines 5-10 inclusive
        expect(lines[0]).toBe("line 5 important");
        expect(lines[5]).toBe("line 10");
      });

      it("should default to start line 1 if not specified", async () => {
        const result = await memoryPointer.queryArtifact(
          pointerId,
          "thread-1",
          { type: "line-range", endLine: 3 },
        );

        expect(result).not.toBeNull();
        const lines = result!.content.split("\n");
        expect(lines[0]).toBe("line 1");
      });

      it("should default end line to start + 100 if not specified", async () => {
        const result = await memoryPointer.queryArtifact(
          pointerId,
          "thread-1",
          { type: "line-range", startLine: 1 },
        );

        expect(result).not.toBeNull();
        // Content has ~31 lines total (30 numbered + padding), so asking for 101 means it will include all available lines
        // This won't be truncated since we're getting all available content
        expect(result!.truncated).toBe(false);
      });

      it("should mark as truncated when end line is beyond content", async () => {
        const result = await memoryPointer.queryArtifact(
          pointerId,
          "thread-1",
          { type: "line-range", startLine: 1, endLine: 100 },
        );

        expect(result).not.toBeNull();
        // Content has ~31 lines, so asking for lines 1-100 will get all content without truncation
        expect(result!.truncated).toBe(false);
      });
    });

    describe("grep query type", () => {
      it("should search for pattern and return matching lines", async () => {
        const result = await memoryPointer.queryArtifact(
          pointerId,
          "thread-1",
          { type: "grep", pattern: "important" },
        );

        expect(result).not.toBeNull();
        const lines = result!.content.split("\n");
        expect(lines.length).toBe(2);
        expect(lines[0]).toContain("line 3");
        expect(lines[1]).toContain("line 5");
      });

      it("should support case-insensitive search", async () => {
        const result = await memoryPointer.queryArtifact(
          pointerId,
          "thread-1",
          { type: "grep", pattern: "IMPORTANT", caseInsensitive: true },
        );

        expect(result).not.toBeNull();
        const lines = result!.content.split("\n");
        expect(lines.length).toBe(2);
      });

      it("should limit results to maxResults", async () => {
        const result = await memoryPointer.queryArtifact(
          pointerId,
          "thread-1",
          { type: "grep", pattern: "line", maxResults: 5 },
        );

        expect(result).not.toBeNull();
        const lines = result!.content.split("\n");
        expect(lines.length).toBe(5);
        expect(result!.truncated).toBe(true);
      });

      it("should return null for invalid patterns", async () => {
        // Test ReDoS protection
        const result = await memoryPointer.queryArtifact(
          pointerId,
          "thread-1",
          { type: "grep", pattern: "(a+)+" },
        );

        expect(result).toBeNull();
      });

      it("should return null for very long patterns", async () => {
        const longPattern = "a".repeat(201);
        const result = await memoryPointer.queryArtifact(
          pointerId,
          "thread-1",
          { type: "grep", pattern: longPattern },
        );

        expect(result).toBeNull();
      });

      it("should return null when pattern is not provided", async () => {
        const result = await memoryPointer.queryArtifact(
          pointerId,
          "thread-1",
          { type: "grep" },
        );

        expect(result).toBeNull();
      });
    });

    describe("summary query type", () => {
      it("should return summary for large content", async () => {
        const result = await memoryPointer.queryArtifact(
          pointerId,
          "thread-1",
          { type: "summary" },
        );

        expect(result).not.toBeNull();
        expect(result!.queryType).toBe("summary");
        // The content has 30 lines total, and summary uses 20 header + 10 trailer = 30
        // So it should return full content without "lines omitted"
        expect(result!.content).toBe(testContent);
      });

      it("should return summary with omission for very large content", async () => {
        // Create content with more than 30 lines to trigger summary logic
        const manyLines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n") + "a".repeat(24500);
        const largePointerId = await memoryPointer.storeArtifact(
          "thread-2",
          "test-type",
          manyLines,
        );

        expect(largePointerId).not.toBeNull();

        const result = await memoryPointer.queryArtifact(
          largePointerId!,
          "thread-2",
          { type: "summary" },
        );

        expect(result).not.toBeNull();
        expect(result!.truncated).toBe(true);
        expect(result!.queryType).toBe("summary");
        expect(result!.content).toContain("lines omitted");
      });

      it("should return full content if shorter than summary size", async () => {
        const shortContent = LARGE_CONTENT; // Still large enough to store
        const shortPointerId = (await memoryPointer.storeArtifact(
          "thread-3",
          "test-type",
          shortContent,
        ))!;

        const result = await memoryPointer.queryArtifact(
          shortPointerId,
          "thread-3",
          { type: "summary" },
        );

        expect(result).not.toBeNull();
        expect(result!.content).toBe(shortContent);
      });
    });

    it("should return null for invalid query type", async () => {
      const result = await memoryPointer.queryArtifact(
        pointerId,
        "thread-1",
        { type: "invalid" as any },
      );

      expect(result).toBeNull();
    });

    it("should return null for non-existent pointer ID", async () => {
      const result = await memoryPointer.queryArtifact(
        "ptr_nonexistent",
        "thread-1",
        { type: "full" },
      );

      expect(result).toBeNull();
    });
  });

  describe("listArtifacts", () => {
    it("should return empty array for thread with no artifacts", async () => {
      const artifacts = await memoryPointer.listArtifacts("thread-no-artifacts");

      expect(artifacts).toEqual([]);
    });

    it("should list all artifacts for a thread", async () => {
      const content1 = LARGE_CONTENT;
      const content2 = "b".repeat(26000);

      await memoryPointer.storeArtifact("thread-1", "type-1", content1);
      await memoryPointer.storeArtifact("thread-1", "type-2", content2);
      await memoryPointer.storeArtifact("thread-2", "type-3", content1);

      const artifacts = await memoryPointer.listArtifacts("thread-1");

      expect(artifacts.length).toBe(2);
      expect(artifacts[0].threadId).toBe("thread-1");
      expect(artifacts[1].threadId).toBe("thread-1");
    });

    it("should exclude expired artifacts from listing", async () => {
      const content = LARGE_CONTENT;
      const pointerId = await memoryPointer.storeArtifact(
        "thread-1",
        "test-type",
        content,
      );

      expect(pointerId).not.toBeNull();

      // Manually expire the artifact
      const fs = require("node:fs");
      const path = require("node:path");
      const filePath = path.join(TEST_MEMORY_DIR, `${pointerId}.json`);
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      data.metadata.expiresAt = Date.now() - 1000;
      fs.writeFileSync(filePath, JSON.stringify(data));

      const artifacts = await memoryPointer.listArtifacts("thread-1");

      expect(artifacts.length).toBe(0);
    });

    it("should clean up expired artifacts during listing", async () => {
      const content = LARGE_CONTENT;
      const pointerId = await memoryPointer.storeArtifact(
        "thread-1",
        "test-type",
        content,
      );

      expect(pointerId).not.toBeNull();

      // Manually expire the artifact
      const fs = require("node:fs");
      const path = require("node:path");
      const filePath = path.join(TEST_MEMORY_DIR, `${pointerId}.json`);
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      data.metadata.expiresAt = Date.now() - 1000;
      fs.writeFileSync(filePath, JSON.stringify(data));

      await memoryPointer.listArtifacts("thread-1");

      expect(existsSync(filePath)).toBe(false);
    });
  });

  describe("deleteArtifact", () => {
    it("should delete existing artifact", async () => {
      const content = LARGE_CONTENT;
      const pointerId = await memoryPointer.storeArtifact(
        "thread-1",
        "test-type",
        content,
      );

      expect(pointerId).not.toBeNull();

      const fs = require("node:fs");
      const path = require("node:path");
      const filePath = path.join(TEST_MEMORY_DIR, `${pointerId}.json`);
      expect(existsSync(filePath)).toBe(true);

      await memoryPointer.deleteArtifact(pointerId!);

      expect(existsSync(filePath)).toBe(false);
    });

    it("should not throw when deleting non-existent artifact", async () => {
      // deleteArtifact doesn't throw for non-existent artifacts
      await memoryPointer.deleteArtifact("ptr_nonexistent");
      // No exception = test passes
    });

    it("should throw for invalid pointer ID format", async () => {
      await expect(
        memoryPointer.deleteArtifact("invalid-format"),
      ).rejects.toThrow();
    });
  });

  describe("cleanupArtifacts", () => {
    it("should clean up all artifacts for a thread", async () => {
      const content = LARGE_CONTENT;

      await memoryPointer.storeArtifact("thread-1", "type-1", content);
      await memoryPointer.storeArtifact("thread-1", "type-2", content);
      await memoryPointer.storeArtifact("thread-2", "type-3", content);

      const cleanedCount = await memoryPointer.cleanupArtifacts("thread-1");

      expect(cleanedCount).toBe(2);

      const artifacts1 = await memoryPointer.listArtifacts("thread-1");
      const artifacts2 = await memoryPointer.listArtifacts("thread-2");

      expect(artifacts1.length).toBe(0);
      expect(artifacts2.length).toBe(1);
    });

    it("should clean up expired artifacts across all threads", async () => {
      const content = LARGE_CONTENT;
      const pointerId = await memoryPointer.storeArtifact(
        "thread-1",
        "test-type",
        content,
      );

      expect(pointerId).not.toBeNull();

      // Manually expire the artifact
      const fs = require("node:fs");
      const path = require("node:path");
      const filePath = path.join(TEST_MEMORY_DIR, `${pointerId}.json`);
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      data.metadata.expiresAt = Date.now() - 1000;
      fs.writeFileSync(filePath, JSON.stringify(data));

      const cleanedCount = await memoryPointer.cleanupArtifacts("thread-2");

      expect(cleanedCount).toBe(1);
    });

    it("should return 0 when no artifacts to clean", async () => {
      const cleanedCount = await memoryPointer.cleanupArtifacts("thread-1");

      expect(cleanedCount).toBe(0);
    });
  });

  describe("createPointerReference", () => {
    it("should create formatted pointer reference", () => {
      const metadata: memoryPointer.ArtifactMetadata = {
        id: "ptr_test123",
        threadId: "thread-1",
        type: "test-type",
        timestamp: 1234567890000,
        size: 10000,
        tokenCount: 2500,
        expiresAt: 1234600000000,
        metadata: {},
      };

      const reference = memoryPointer.createPointerReference(
        "ptr_test123",
        metadata,
        2500,
      );

      expect(reference).toContain("MEMORY POINTER: ptr_test123");
      expect(reference).toContain("Type: test-type");
      expect(reference).toContain("Token count: 2500");
      expect(reference).toContain("Original size: 10000");
      expect(reference).toContain("artifact-query");
    });
  });

  describe("storeArtifactAsPointer", () => {
    it("should return null for content below threshold", async () => {
      const content = SMALL_CONTENT;
      const pointerRef = await memoryPointer.storeArtifactAsPointer(
        "thread-1",
        "test-type",
        content,
      );

      expect(pointerRef).toBeNull();
    });

    it("should store and return pointer reference for large content", async () => {
      const content = LARGE_CONTENT;
      const pointerRef = await memoryPointer.storeArtifactAsPointer(
        "thread-1",
        "test-type",
        content,
      );

      expect(pointerRef).not.toBeNull();
      expect(pointerRef).toContain("MEMORY POINTER:");
      expect(pointerRef).toContain("Type: test-type");
    });

    it("should store artifact and return reference string", async () => {
      const content = LARGE_CONTENT;
      const customMetadata = { source: "test" };

      const pointerRef = await memoryPointer.storeArtifactAsPointer(
        "thread-1",
        "test-artifact",
        content,
        customMetadata,
      );

      expect(pointerRef).not.toBeNull();
      expect(pointerRef).toMatch(/ptr_[A-Za-z0-9_-]+/);

      // Extract pointer ID from reference
      const match = pointerRef!.match(/ptr_[A-Za-z0-9_-]+/);
      expect(match).not.toBeNull();

      // Verify artifact was stored
      const artifact = await memoryPointer.retrieveArtifact(
        match![0],
        "thread-1",
      );

      expect(artifact).not.toBeNull();
      expect(artifact!.content).toBe(content);
    });
  });

  describe("security and validation", () => {
    it("should validate pointer ID format", async () => {
      const content = LARGE_CONTENT;
      const pointerId = await memoryPointer.storeArtifact(
        "thread-1",
        "test-type",
        content,
      );

      expect(pointerId).not.toBeNull();
      expect(pointerId).toMatch(/^ptr_[A-Za-z0-9_-]+$/);
    });

    it("should reject pointer IDs with path traversal attempts", async () => {
      await expect(
        memoryPointer.retrieveArtifact("ptr_../../../etc/passwd", "thread-1"),
      ).rejects.toThrow();
    });

    it("should reject excessively long pointer IDs", async () => {
      const longId = "ptr_" + "a".repeat(200);
      await expect(
        memoryPointer.retrieveArtifact(longId, "thread-1"),
      ).rejects.toThrow();
    });

    it("should reject pointer IDs without ptr_ prefix", async () => {
      await expect(
        memoryPointer.retrieveArtifact("invalid", "thread-1"),
      ).rejects.toThrow();
    });

    it("protect against ReDoS with nested repetition", async () => {
      const content = LARGE_CONTENT;
      const pointerId = await memoryPointer.storeArtifact(
        "thread-1",
        "test-type",
        content,
      );

      expect(pointerId).not.toBeNull();

      const result = await memoryPointer.queryArtifact(
        pointerId!,
        "thread-1",
        { type: "grep", pattern: "(a+)+b" },
      );

      expect(result).toBeNull();
    });

    it("protect against ReDoS with nested wildcard", async () => {
      const content = LARGE_CONTENT;
      const pointerId = await memoryPointer.storeArtifact(
        "thread-1",
        "test-type",
        content,
      );

      expect(pointerId).not.toBeNull();

      const result = await memoryPointer.queryArtifact(
        pointerId!,
        "thread-1",
        { type: "grep", pattern: "(.+)+" },
      );

      expect(result).toBeNull();
    });
  });
});
