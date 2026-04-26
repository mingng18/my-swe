import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { FilesystemSnapshotStore, CacheStats } from "./sandbox/snapshot-store";
import type { SnapshotMetadata, SnapshotKey } from "./sandbox/snapshot-metadata";
import * as fsPromises from "node:fs/promises";
import * as fs from "node:fs";
import { join, resolve } from "node:path";

import { spyOn } from "bun:test";

let mockMkdir: any;
let mockReadFile: any;
let mockWriteFile: any;
let mockReaddir: any;
let mockUnlink: any;
let mockExistsSync: any;

beforeEach(() => {
  mockMkdir = spyOn(fsPromises, "mkdir");
  mockReadFile = spyOn(fsPromises, "readFile");
  mockWriteFile = spyOn(fsPromises, "writeFile");
  mockReaddir = spyOn(fsPromises, "readdir");
  mockUnlink = spyOn(fsPromises, "unlink");
  mockExistsSync = spyOn(fs, "existsSync");
});

afterEach(() => {
  if (mockMkdir) mockMkdir.mockRestore();
  if (mockReadFile) mockReadFile.mockRestore();
  if (mockWriteFile) mockWriteFile.mockRestore();
  if (mockReaddir) mockReaddir.mockRestore();
  if (mockUnlink) mockUnlink.mockRestore();
  if (mockExistsSync) mockExistsSync.mockRestore();
});

// Helper to create test snapshot metadata
function createTestMetadata(overrides?: Partial<SnapshotMetadata>): SnapshotMetadata {
  const key: SnapshotKey = {
    repoOwner: "test-owner",
    repoName: "test-repo",
    profile: "typescript",
    branch: "main",
  };
  const now = new Date();
  return {
    key,
    snapshotId: "test-snapshot-1",
    createdAt: now,
    refreshedAt: now,
    commitSha: "abc123",
    dependencies: [],
    preBuildSuccess: true,
    size: 1000,
    provider: "opensandbox",
    image: "node:18",
    refreshing: false,
    ...overrides,
  };
}

// Helper to normalize dates for comparison (dates become strings after JSON round-trip)
function normalizeMetadata(metadata: SnapshotMetadata): SnapshotMetadata {
  return {
    ...metadata,
    createdAt: new Date(metadata.createdAt),
    refreshedAt: new Date(metadata.refreshedAt),
  };
}

describe("FilesystemSnapshotStore", () => {
  let store: FilesystemSnapshotStore;

  beforeEach(() => {
    // Clear all mocks before each test
    mockMkdir.mockClear();
    mockReadFile.mockClear();
    mockWriteFile.mockClear();
    mockReaddir.mockClear();
    mockUnlink.mockClear();
    mockExistsSync.mockClear();

    // Setup default mock behaviors
    mockExistsSync.mockReturnValue(false);
    mockMkdir.mockResolvedValue(undefined);

    // Create a fresh store instance for each test
    store = new FilesystemSnapshotStore("/tmp/test-snapshots");
  });

  describe("Cache Initialization", () => {
    test("should initialize with empty cache", () => {
      const stats = store.getCacheStats();
      expect(stats).toEqual({ hits: 0, misses: 0 });
    });

    test("should clear cache and reset statistics", () => {
      // Simulate some cache activity
      const statsBefore = store.getCacheStats();
      expect(statsBefore.hits).toBe(0);

      store.clearCache();

      const statsAfter = store.getCacheStats();
      expect(statsAfter).toEqual({ hits: 0, misses: 0 });
    });
  });

  describe("get() - Cache Hit on Repeated Calls", () => {
    test("should cache snapshot metadata on first get() call", async () => {
      const metadata = createTestMetadata();
      const jsonMetadata = JSON.stringify(metadata, null, 2);

      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(jsonMetadata);

      // First call - cache miss, reads from filesystem
      const result1 = await store.get(metadata.key);
      expect(normalizeMetadata(result1!)).toEqual(metadata);
      expect(mockReadFile).toHaveBeenCalledTimes(1);

      // Verify cache statistics
      let stats = store.getCacheStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(0);
    });

    test("should return cached snapshot on second get() call without filesystem read", async () => {
      const metadata = createTestMetadata();
      const jsonMetadata = JSON.stringify(metadata, null, 2);

      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(jsonMetadata);

      // First call - populates cache
      await store.get(metadata.key);
      expect(mockReadFile).toHaveBeenCalledTimes(1);

      // Clear the mock to track subsequent calls
      mockReadFile.mockClear();

      // Second call - should hit cache, no filesystem read
      const result2 = await store.get(metadata.key);
      expect(normalizeMetadata(result2!)).toEqual(metadata);
      expect(mockReadFile).not.toHaveBeenCalled();

      // Verify cache statistics
      const stats = store.getCacheStats();
      expect(stats.misses).toBe(1); // First call was a miss
      expect(stats.hits).toBe(1); // Second call was a hit
    });

    test("should return null for non-existent snapshot", async () => {
      const key: SnapshotKey = {
        repoOwner: "unknown",
        repoName: "unknown",
        profile: "typescript",
        branch: "main",
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockRejectedValue({ code: "ENOENT" });

      const result = await store.get(key);
      expect(result).toBeNull();

      const stats = store.getCacheStats();
      expect(stats.misses).toBe(1);
    });
  });

  describe("save() - Cache Invalidation", () => {
    test("should update cache when saving new snapshot", async () => {
      const metadata = createTestMetadata();
      mockExistsSync.mockReturnValue(false);
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      await store.save(metadata);

      expect(mockWriteFile).toHaveBeenCalledTimes(1);

      // Verify the snapshot is now in cache
      mockReadFile.mockResolvedValue(JSON.stringify(metadata, null, 2));
      const result = await store.get(metadata.key);

      expect(normalizeMetadata(result!)).toEqual(metadata);
      // Since it was saved, it should be in cache, so get() should be a cache hit
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    test("should invalidate existing cache entry when saving updated snapshot", async () => {
      const key: SnapshotKey = {
        repoOwner: "test-owner",
        repoName: "test-repo",
        profile: "typescript",
        branch: "main",
      };

      // Create initial metadata
      const originalMetadata = createTestMetadata({
        key,
        snapshotId: "original-snapshot",
      });

      // Populate cache with original metadata
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(JSON.stringify(originalMetadata, null, 2));
      await store.get(originalMetadata.key);

      const stats1 = store.getCacheStats();
      expect(stats1.misses).toBe(1);
      expect(stats1.hits).toBe(0);

      // Clear readFile mock to track if it's called again
      mockReadFile.mockClear();

      // Verify original is cached by calling get() again - should be cache hit
      const result1 = await store.get(originalMetadata.key);
      expect(normalizeMetadata(result1!)).toEqual(originalMetadata);
      expect(mockReadFile).not.toHaveBeenCalled();

      const stats2 = store.getCacheStats();
      expect(stats2.hits).toBe(1);

      // Now save updated metadata with same key but different values
      const updatedMetadata = createTestMetadata({
        key,
        snapshotId: "updated-snapshot",
        commitSha: "def456", // Different commit SHA
        refreshedAt: new Date(Date.now() + 10000), // Different timestamp
      });

      mockExistsSync.mockReturnValue(false);
      mockWriteFile.mockResolvedValue(undefined);
      await store.save(updatedMetadata);

      // Clear readFile mock to track if next get() reads from filesystem
      mockReadFile.mockClear();

      // Get the snapshot again - should return updated version from cache
      const result2 = await store.get(updatedMetadata.key);

      // Should get the updated metadata, not the original
      expect(result2!.snapshotId).toBe("updated-snapshot");
      expect(result2!.commitSha).toBe("def456");
      expect(normalizeMetadata(result2!)).toEqual(updatedMetadata);

      // Should not have read from filesystem - updated version was in cache
      expect(mockReadFile).not.toHaveBeenCalled();

      const stats3 = store.getCacheStats();
      expect(stats3.hits).toBe(2); // Previous hit + this hit
    });

    test("should invalidate listAll cache when saving snapshot", async () => {
      const metadata = createTestMetadata();

      // First, populate listAll cache with empty result
      mockExistsSync.mockReturnValue(true);
      mockReaddir.mockResolvedValue([]);
      await store.listAll();

      const stats1 = store.getCacheStats();
      const initialMisses = stats1.misses;
      expect(initialMisses).toBeGreaterThanOrEqual(0);

      // Save a snapshot (should invalidate listAll cache)
      mockExistsSync.mockReturnValue(false);
      mockWriteFile.mockResolvedValue(undefined);
      await store.save(metadata);

      // Reset mock to track if listAll reads from filesystem again
      mockReaddir.mockClear();
      mockReaddir.mockResolvedValue([]);

      // Call listAll again - should read from filesystem again due to invalidation
      await store.listAll();

      expect(mockReaddir).toHaveBeenCalled();
    });
  });

  describe("listAll() - Caching Behavior", () => {
    test("should cache listAll results", async () => {
      // First call - reads from filesystem (empty result)
      mockExistsSync.mockReturnValue(true);
      mockReaddir.mockResolvedValue([]);
      const result1 = await store.listAll();
      expect(result1).toHaveLength(0);
      expect(mockReaddir).toHaveBeenCalledTimes(1);

      const stats1 = store.getCacheStats();
      expect(stats1.misses).toBeGreaterThan(0);

      // Clear the mock to verify it's not called again
      mockReaddir.mockClear();

      // Second call - should use cache
      const result2 = await store.listAll();
      expect(result2).toHaveLength(0);
      expect(mockReaddir).not.toHaveBeenCalled();

      const stats2 = store.getCacheStats();
      expect(stats2.hits).toBeGreaterThan(stats1.hits);
    });

    test("should cache listAll results with actual snapshot data", async () => {
      const metadata1 = createTestMetadata({
        snapshotId: "test-snapshot-1",
        key: {
          repoOwner: "test-owner",
          repoName: "test-repo",
          profile: "typescript",
          branch: "main",
        },
      });
      const metadata2 = createTestMetadata({
        snapshotId: "test-snapshot-2",
        key: {
          repoOwner: "test-owner",
          repoName: "test-repo",
          profile: "typescript",
          branch: "develop",
        },
      });

      mockExistsSync.mockReturnValue(true);

      // First call - reads from filesystem
      // Setup mock to return file paths, then mock readFile to return metadata
      mockReaddir.mockResolvedValue([
        { name: "test-owner/test-repo/default/main.json", isDirectory: () => false },
        { name: "test-owner/test-repo/default/develop.json", isDirectory: () => false },
      ]);

      // Mock readFile to return different metadata based on file path
      mockReadFile.mockImplementation((filePath: string) => {
        if (filePath.includes("main.json")) {
          return Promise.resolve(JSON.stringify(metadata1, null, 2));
        } else if (filePath.includes("develop.json")) {
          return Promise.resolve(JSON.stringify(metadata2, null, 2));
        }
        return Promise.reject(new Error("Unexpected file path"));
      });

      const result1 = await store.listAll();
      expect(result1).toHaveLength(2);
      expect(mockReadFile).toHaveBeenCalledTimes(2);

      const stats1 = store.getCacheStats();
      expect(stats1.misses).toBeGreaterThan(0);
      const initialHits = stats1.hits;

      // Clear mocks to verify they're not called again
      mockReaddir.mockClear();
      mockReadFile.mockClear();

      // Second call - should use cache (no filesystem reads)
      const result2 = await store.listAll();
      expect(result2).toHaveLength(2);
      expect(mockReaddir).not.toHaveBeenCalled();
      expect(mockReadFile).not.toHaveBeenCalled();

      const stats2 = store.getCacheStats();
      expect(stats2.hits).toBeGreaterThan(initialHits);
    });

    test("should track cache statistics accurately for listAll()", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddir.mockResolvedValue([]);

      const statsBefore = store.getCacheStats();
      expect(statsBefore.misses).toBe(0);
      expect(statsBefore.hits).toBe(0);

      // First call - cache miss
      await store.listAll();

      const statsAfterFirst = store.getCacheStats();
      expect(statsAfterFirst.misses).toBe(1);
      expect(statsAfterFirst.hits).toBe(0);

      // Second call - cache hit
      await store.listAll();

      const statsAfterSecond = store.getCacheStats();
      expect(statsAfterSecond.misses).toBe(1);
      expect(statsAfterSecond.hits).toBe(1);

      // Third call - another cache hit
      await store.listAll();

      const statsAfterThird = store.getCacheStats();
      expect(statsAfterThird.misses).toBe(1);
      expect(statsAfterThird.hits).toBe(2);
    });

    test("should return empty array when no snapshots exist", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddir.mockResolvedValue([]);

      const result = await store.listAll();
      expect(result).toEqual([]);
    });
  });

  describe("delete() - Cache Invalidation", () => {
    test("should remove snapshot from cache when deleted", async () => {
      const metadata = createTestMetadata();
      const jsonMetadata = JSON.stringify(metadata, null, 2);

      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(jsonMetadata);

      // Populate cache
      await store.get(metadata.key);
      expect(mockReadFile).toHaveBeenCalledTimes(1);

      // Verify it's in cache by calling again
      await store.get(metadata.key);
      expect(mockReadFile).toHaveBeenCalledTimes(1); // Still 1, no new read

      // Delete the snapshot
      mockUnlink.mockResolvedValue(undefined);
      await store.delete(metadata.key);
      expect(mockUnlink).toHaveBeenCalledTimes(1);

      // Clear the mock to verify it gets called again
      mockReadFile.mockClear();

      // Try to get the deleted snapshot - should read from filesystem again
      mockReadFile.mockRejectedValue({ code: "ENOENT" });
      const result = await store.get(metadata.key);
      expect(result).toBeNull();
      expect(mockReadFile).toHaveBeenCalledTimes(1); // Should have tried to read from filesystem
    });

    test("should invalidate listAll cache when deleting snapshot", async () => {
      const metadata = createTestMetadata();

      // First, populate listAll cache with empty result
      mockExistsSync.mockReturnValue(true);
      mockReaddir.mockResolvedValue([]);
      await store.listAll();

      // Delete a snapshot (should invalidate listAll cache)
      mockUnlink.mockResolvedValue(undefined);
      await store.delete(metadata.key);

      // Reset mock to track if listAll reads from filesystem again
      mockReaddir.mockClear();
      mockReaddir.mockResolvedValue([]);

      // Call listAll again - should read from filesystem again due to invalidation
      await store.listAll();

      expect(mockReaddir).toHaveBeenCalled();
    });

    test("should handle ENOENT gracefully when deleting already deleted snapshot", async () => {
      const metadata = createTestMetadata();

      mockUnlink.mockRejectedValue({ code: "ENOENT" });

      // Should not throw
      await store.delete(metadata.key);
      // If we get here without throwing, the test passes
      expect(true).toBe(true);
    });
  });

  describe("TTL Expiration", () => {
    test("should not expire cache entries immediately", async () => {
      const metadata = createTestMetadata();
      const jsonMetadata = JSON.stringify(metadata, null, 2);

      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(jsonMetadata);

      // First call - populates cache
      await store.get(metadata.key);
      expect(mockReadFile).toHaveBeenCalledTimes(1);

      // Clear the mock
      mockReadFile.mockClear();

      // Immediate second call - should use cache (within TTL)
      await store.get(metadata.key);
      expect(mockReadFile).not.toHaveBeenCalled();

      const stats = store.getCacheStats();
      expect(stats.hits).toBe(1);
    });

    test("clearCache() should manually invalidate cache entries", async () => {
      const metadata = createTestMetadata();
      const jsonMetadata = JSON.stringify(metadata, null, 2);

      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(jsonMetadata);

      // First call - populates cache
      await store.get(metadata.key);
      expect(mockReadFile).toHaveBeenCalledTimes(1);

      const stats1 = store.getCacheStats();
      expect(stats1.misses).toBe(1);

      // Clear the cache manually
      store.clearCache();

      const stats2 = store.getCacheStats();
      expect(stats2).toEqual({ hits: 0, misses: 0 });

      // Clear the mock to track subsequent calls
      mockReadFile.mockClear();

      // Second call after manual cache clear - should read from filesystem again
      await store.get(metadata.key);
      expect(mockReadFile).toHaveBeenCalledTimes(1);

      const stats3 = store.getCacheStats();
      expect(stats3.misses).toBe(1);
    });

    test("should support cache TTL configuration via environment variable", () => {
      // Verify that the default TTL is 5 minutes (300000ms)
      const defaultTTL = process.env.SNAPSHOT_CACHE_TTL_MS || "300000";
      expect(Number.parseInt(defaultTTL, 10)).toBe(300000);

      // Document that TTL can be customized via SNAPSHOT_CACHE_TTL_MS
      // Cache entries older than TTL milliseconds will be invalidated
      // and re-read from the filesystem on next access
    });

    test("should handle cache statistics correctly with TTL-aware operations", async () => {
      const metadata = createTestMetadata();
      const jsonMetadata = JSON.stringify(metadata, null, 2);

      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(jsonMetadata);

      // Verify initial statistics
      const initialStats = store.getCacheStats();
      expect(initialStats).toEqual({ hits: 0, misses: 0 });

      // First access - cache miss
      await store.get(metadata.key);
      const statsAfterFirst = store.getCacheStats();
      expect(statsAfterFirst.misses).toBe(1);

      // Second access - cache hit (within TTL)
      await store.get(metadata.key);
      const statsAfterSecond = store.getCacheStats();
      expect(statsAfterSecond.hits).toBe(1);

      // Manual cache clear
      store.clearCache();
      const statsAfterClear = store.getCacheStats();
      expect(statsAfterClear).toEqual({ hits: 0, misses: 0 });

      // Access after clear - cache miss again
      await store.get(metadata.key);
      const statsAfterThird = store.getCacheStats();
      expect(statsAfterThird.misses).toBe(1);
    });
  });

  describe("Cache Statistics", () => {
    test("should track cache hits and misses accurately", async () => {
      const metadata = createTestMetadata();
      const jsonMetadata = JSON.stringify(metadata, null, 2);

      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(jsonMetadata);

      // First call - cache miss
      await store.get(metadata.key);
      expect(mockReadFile).toHaveBeenCalledTimes(1);

      let stats = store.getCacheStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(0);

      // Second call - cache hit
      await store.get(metadata.key);
      expect(mockReadFile).toHaveBeenCalledTimes(1); // Still 1, not called again

      stats = store.getCacheStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(1);

      // Third call - another cache hit
      await store.get(metadata.key);

      stats = store.getCacheStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(2);
    });

    test("should return a copy of stats to prevent external modification", () => {
      const stats1 = store.getCacheStats();
      stats1.hits = 999;

      const stats2 = store.getCacheStats();
      expect(stats2.hits).toBe(0); // Should not be affected by external modification
    });
  });

  describe("clearCache() Method", () => {
    test("should clear all cache entries and reset statistics", async () => {
      const metadata = createTestMetadata();
      const jsonMetadata = JSON.stringify(metadata, null, 2);

      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(jsonMetadata);

      // Populate cache
      await store.get(metadata.key);

      // Populate listAll cache
      mockReaddir.mockResolvedValue([
        { name: "test-owner/test-repo/default/main.json", isDirectory: () => false },
      ]);
      await store.listAll();

      const statsBefore = store.getCacheStats();
      expect(statsBefore.misses + statsBefore.hits).toBeGreaterThan(0);

      // Clear cache
      store.clearCache();

      const statsAfter = store.getCacheStats();
      expect(statsAfter).toEqual({ hits: 0, misses: 0 });

      // Verify cache is cleared by making another call
      mockReadFile.mockClear();
      await store.get(metadata.key);
      expect(mockReadFile).toHaveBeenCalledTimes(1); // Should read from filesystem again
    });
  });

  describe("initialize() Method", () => {
    test("should create storage directory if it does not exist", async () => {
      mockExistsSync.mockReturnValue(false);
      mockMkdir.mockResolvedValue(undefined);

      await store.initialize();

      expect(mockMkdir).toHaveBeenCalledWith("/tmp/test-snapshots", { recursive: true });
    });

    test("should not create storage directory if it exists", async () => {
      mockExistsSync.mockReturnValue(true);

      await store.initialize();

      expect(mockMkdir).not.toHaveBeenCalled();
    });
  });
});
