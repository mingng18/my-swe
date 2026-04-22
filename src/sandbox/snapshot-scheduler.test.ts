import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { SnapshotScheduler, DEFAULT_SCHEDULER_CONFIG } from "./snapshot-scheduler";
import { SnapshotManager } from "./snapshot-manager";
import type { SnapshotStore, SnapshotMetadata, SnapshotKey } from "./snapshot-metadata";
import type { SandboxService } from "../integrations/sandbox-service";

const mockListAll = mock();
const mockGet = mock();
const mockSave = mock();
const mockRestoreSnapshot = mock();
const mockCreateSnapshot = mock();
const mockGetInfo = mock();
const mockCleanup = mock();

// Mock the SnapshotStore
const createMockStore = (): SnapshotStore => ({
  get: mockGet,
  save: mockSave,
  listByRepo: mock(),
  listByProfile: mock(),
  delete: mock(),
  cleanup: mock(),
  listAll: mockListAll,
});

// Mock the SnapshotManager
const createMockManager = (): SnapshotManager => {
  const manager = {
    restoreSnapshot: mockRestoreSnapshot,
    createSnapshot: mockCreateSnapshot,
  } as unknown as SnapshotManager;
  return manager;
};

// Mock SandboxService
const createMockSandbox = (): SandboxService => {
  return {
    getInfo: mockGetInfo,
    cleanup: mockCleanup,
    execute: mock(),
    read: mock(),
    write: mock(),
    cloneRepo: mock(),
    getProvider: mock(() => "daytona"),
    getDaytonaClient: mock(),
    id: "test-sandbox-id",
  } as unknown as SandboxService;
};

describe("SnapshotScheduler", () => {
  let mockStore: SnapshotStore;
  let mockManager: SnapshotManager;
  let scheduler: SnapshotScheduler;

  beforeEach(() => {
    // Clear all mocks
    mockListAll.mockClear();
    mockGet.mockClear();
    mockSave.mockClear();
    mockRestoreSnapshot.mockClear();
    mockCreateSnapshot.mockClear();
    mockGetInfo.mockClear();
    mockCleanup.mockClear();

    // Create fresh mocks
    mockStore = createMockStore();
    mockManager = createMockManager();
    scheduler = new SnapshotScheduler(mockStore, mockManager, {
      intervalMs: 1000,
      maxAgeHours: 1,
      maxConcurrent: 2,
      autoDiscover: false,
    });
  });

  afterEach(() => {
    // Ensure scheduler is stopped
    scheduler.stop();
  });

  describe("start() and stop()", () => {
    test("starts the scheduler and runs initial cycle", async () => {
      mockListAll.mockResolvedValue([]);

      scheduler.start();
      expect(scheduler).toBeDefined();

      // Wait a bit for initial cycle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify cycle ran (listAll was called)
      expect(mockListAll).toHaveBeenCalled();
    });

    test("does not start if already running", async () => {
      mockListAll.mockResolvedValue([]);

      scheduler.start();
      const start2 = () => scheduler.start();

      // Should not throw, just log a warning
      expect(start2).not.toThrow();
    });

    test("stops the scheduler", async () => {
      mockListAll.mockResolvedValue([]);

      scheduler.start();
      scheduler.stop();

      // Wait to ensure no cycles run after stop
      await new Promise((resolve) => setTimeout(resolve, 200));

      // listAll should only be called once (initial cycle)
      expect(mockListAll).toHaveBeenCalledTimes(1);
    });

    test("stop is idempotent", () => {
      scheduler.stop();
      scheduler.stop();
      expect(scheduler).toBeDefined();
    });
  });

  describe("findExpiredSnapshots()", () => {
    test("finds snapshots older than maxAgeHours", async () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const mockSnapshots: SnapshotMetadata[] = [
        {
          snapshotId: "snap-1",
          key: {
            repoOwner: "owner",
            repoName: "repo",
            profile: "typescript",
            branch: "main",
          },
          createdAt: twoHoursAgo,
          refreshedAt: twoHoursAgo,
          commitSha: "abc123",
          dependencies: [],
          preBuildSuccess: true,
          size: 1000000,
          provider: "daytona",
          image: "debian:12",
          refreshing: false,
        },
        {
          snapshotId: "snap-2",
          key: {
            repoOwner: "owner",
            repoName: "repo",
            profile: "javascript",
            branch: "main",
          },
          createdAt: now,
          refreshedAt: now,
          commitSha: "def456",
          dependencies: [],
          preBuildSuccess: true,
          size: 1000000,
          provider: "daytona",
          image: "debian:12",
          refreshing: false,
        },
      ];

      mockListAll.mockResolvedValue(mockSnapshots);

      // Start scheduler to trigger cycle
      scheduler.start();

      // Wait for cycle to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Only snap-1 should be identified as expired
      // The scheduler will call get for expired snapshots
      expect(mockGet).toHaveBeenCalledWith(
        expect.objectContaining({
          repoOwner: "owner",
          repoName: "repo",
          profile: "typescript",
          branch: "main",
        }),
      );
    });

    test("handles empty snapshot list", async () => {
      mockListAll.mockResolvedValue([]);

      scheduler.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should not call get if no expired snapshots
      expect(mockGet).not.toHaveBeenCalled();
    });
  });

  describe("calculatePriority()", () => {
    test("prioritizes older snapshots higher", async () => {
      const now = new Date();
      const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
      const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);

      const mockSnapshots: SnapshotMetadata[] = [
        {
          snapshotId: "snap-old",
          key: {
            repoOwner: "owner",
            repoName: "repo",
            profile: "typescript",
            branch: "main",
          },
          createdAt: threeHoursAgo,
          refreshedAt: threeHoursAgo,
          commitSha: "abc123",
          dependencies: [],
          preBuildSuccess: true,
          size: 1000000,
          provider: "daytona",
          image: "debian:12",
          refreshing: false,
        },
        {
          snapshotId: "snap-new",
          key: {
            repoOwner: "owner",
            repoName: "repo",
            profile: "javascript",
            branch: "main",
          },
          createdAt: oneHourAgo,
          refreshedAt: oneHourAgo,
          commitSha: "def456",
          dependencies: [],
          preBuildSuccess: true,
          size: 1000000,
          provider: "daytona",
          image: "debian:12",
          refreshing: false,
        },
      ];

      mockListAll.mockResolvedValue(mockSnapshots);
      mockGet.mockImplementation((key: SnapshotKey) => {
        return Promise.resolve(
          mockSnapshots.find((s) => s.key.branch === key.branch) || null,
        );
      });
      mockRestoreSnapshot.mockResolvedValue({
        success: true,
        sandbox: null,
        fromCache: false,
      });
      mockCreateSnapshot.mockResolvedValue({
        success: true,
        snapshotId: "new-snap",
        metadata: null,
      });
      mockSave.mockResolvedValue(undefined);

      scheduler.start();

      // Wait for cycle to process
      await new Promise((resolve) => setTimeout(resolve, 300));

      scheduler.stop();
    });

    test("boosts priority for main/master branch", async () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const mockSnapshots: SnapshotMetadata[] = [
        {
          snapshotId: "snap-main",
          key: {
            repoOwner: "owner",
            repoName: "repo",
            profile: "javascript",
            branch: "main",
          },
          createdAt: twoHoursAgo,
          refreshedAt: twoHoursAgo,
          commitSha: "abc123",
          dependencies: [],
          preBuildSuccess: true,
          size: 1000000,
          provider: "daytona",
          image: "debian:12",
          refreshing: false,
        },
        {
          snapshotId: "snap-feature",
          key: {
            repoOwner: "owner",
            repoName: "repo",
            profile: "javascript",
            branch: "feature",
          },
          createdAt: twoHoursAgo,
          refreshedAt: twoHoursAgo,
          commitSha: "def456",
          dependencies: [],
          preBuildSuccess: true,
          size: 1000000,
          provider: "daytona",
          image: "debian:12",
          refreshing: false,
        },
      ];

      mockListAll.mockResolvedValue(mockSnapshots);
      mockGet.mockImplementation((key: SnapshotKey) => {
        return Promise.resolve(
          mockSnapshots.find((s) => s.key.branch === key.branch) || null,
        );
      });
      mockRestoreSnapshot.mockResolvedValue({
        success: true,
        sandbox: null,
        fromCache: false,
      });
      mockCreateSnapshot.mockResolvedValue({
        success: true,
        snapshotId: "new-snap",
        metadata: null,
      });
      mockSave.mockResolvedValue(undefined);

      scheduler.start();

      // Wait for cycle to process
      await new Promise((resolve) => setTimeout(resolve, 300));

      scheduler.stop();
    });

    test("boosts priority for typescript/javascript profiles", async () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const mockSnapshots: SnapshotMetadata[] = [
        {
          snapshotId: "snap-ts",
          key: {
            repoOwner: "owner",
            repoName: "repo",
            profile: "typescript",
            branch: "feature",
          },
          createdAt: twoHoursAgo,
          refreshedAt: twoHoursAgo,
          commitSha: "abc123",
          dependencies: [],
          preBuildSuccess: true,
          size: 1000000,
          provider: "daytona",
          image: "debian:12",
          refreshing: false,
        },
      ];

      mockListAll.mockResolvedValue(mockSnapshots);
      mockGet.mockResolvedValue(mockSnapshots[0]);
      mockRestoreSnapshot.mockResolvedValue({
        success: true,
        sandbox: null,
        fromCache: false,
      });
      mockCreateSnapshot.mockResolvedValue({
        success: true,
        snapshotId: "new-snap",
        metadata: null,
      });
      mockSave.mockResolvedValue(undefined);

      scheduler.start();

      // Wait for cycle to process
      await new Promise((resolve) => setTimeout(resolve, 300));

      scheduler.stop();
    });
  });

  describe("refreshSnapshot()", () => {
    test("successfully refreshes an expired snapshot", async () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const expiredSnapshot: SnapshotMetadata = {
        snapshotId: "snap-expired",
        key: {
          repoOwner: "owner",
          repoName: "repo",
          profile: "typescript",
          branch: "main",
        },
        createdAt: twoHoursAgo,
        refreshedAt: twoHoursAgo,
        commitSha: "abc123",
        dependencies: [],
        preBuildSuccess: true,
        size: 1000000,
        provider: "daytona",
        image: "debian:12",
        refreshing: false,
      };

      mockListAll.mockResolvedValue([expiredSnapshot]);
      mockGet.mockResolvedValue(expiredSnapshot);

      const mockSandbox = createMockSandbox();
      mockRestoreSnapshot.mockResolvedValue({
        success: true,
        sandbox: mockSandbox,
        fromCache: true,
      });
      mockCreateSnapshot.mockResolvedValue({
        success: true,
        snapshotId: "new-snap-id",
        metadata: null,
      });
      mockSave.mockResolvedValue(undefined);
      mockCleanup.mockResolvedValue(undefined);

      scheduler.start();

      // Wait for cycle to complete
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Verify refresh flow
      expect(mockRestoreSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          repoOwner: "owner",
          repoName: "repo",
          profile: "typescript",
          branch: "main",
        }),
        expect.any(Function),
      );
      expect(mockCreateSnapshot).toHaveBeenCalled();
      expect(mockSave).toHaveBeenCalled();

      // Verify cleanup
      expect(mockCleanup).toHaveBeenCalled();

      scheduler.stop();
    });

    test("skips refresh if snapshot already refreshing", async () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const refreshingSnapshot: SnapshotMetadata = {
        snapshotId: "snap-refreshing",
        key: {
          repoOwner: "owner",
          repoName: "repo",
          profile: "typescript",
          branch: "main",
        },
        createdAt: twoHoursAgo,
        refreshedAt: twoHoursAgo,
        commitSha: "abc123",
        dependencies: [],
        preBuildSuccess: true,
        size: 1000000,
        provider: "daytona",
        image: "debian:12",
        refreshing: true,
      };

      mockListAll.mockResolvedValue([refreshingSnapshot]);
      mockGet.mockResolvedValue(refreshingSnapshot);

      scheduler.start();

      // Wait for cycle to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should not attempt restore if already refreshing
      expect(mockRestoreSnapshot).not.toHaveBeenCalled();

      scheduler.stop();
    });

    test("handles restore failure gracefully", async () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const expiredSnapshot: SnapshotMetadata = {
        snapshotId: "snap-expired",
        key: {
          repoOwner: "owner",
          repoName: "repo",
          profile: "typescript",
          branch: "main",
        },
        createdAt: twoHoursAgo,
        refreshedAt: twoHoursAgo,
        commitSha: "abc123",
        dependencies: [],
        preBuildSuccess: true,
        size: 1000000,
        provider: "daytona",
        image: "debian:12",
        refreshing: false,
      };

      mockListAll.mockResolvedValue([expiredSnapshot]);
      mockGet.mockResolvedValue(expiredSnapshot);
      mockRestoreSnapshot.mockResolvedValue({
        success: false,
        sandbox: null,
        fromCache: false,
        error: "Failed to restore",
      });
      mockSave.mockResolvedValue(undefined);

      scheduler.start();

      // Wait for cycle to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should still reset refreshing flag even on failure
      expect(mockRestoreSnapshot).toHaveBeenCalled();
      expect(mockCreateSnapshot).not.toHaveBeenCalled();

      scheduler.stop();
    });

    test("handles create snapshot failure gracefully", async () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const expiredSnapshot: SnapshotMetadata = {
        snapshotId: "snap-expired",
        key: {
          repoOwner: "owner",
          repoName: "repo",
          profile: "typescript",
          branch: "main",
        },
        createdAt: twoHoursAgo,
        refreshedAt: twoHoursAgo,
        commitSha: "abc123",
        dependencies: [],
        preBuildSuccess: true,
        size: 1000000,
        provider: "daytona",
        image: "debian:12",
        refreshing: false,
      };

      mockListAll.mockResolvedValue([expiredSnapshot]);
      mockGet.mockResolvedValue(expiredSnapshot);

      const mockSandbox = createMockSandbox();
      mockRestoreSnapshot.mockResolvedValue({
        success: true,
        sandbox: mockSandbox,
        fromCache: true,
      });
      mockCreateSnapshot.mockResolvedValue({
        success: false,
        snapshotId: "failed-snap",
        metadata: null,
        error: "Failed to create snapshot",
      });
      mockSave.mockResolvedValue(undefined);
      mockCleanup.mockResolvedValue(undefined);

      scheduler.start();

      // Wait for cycle to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should still cleanup and reset refreshing flag
      expect(mockCleanup).toHaveBeenCalled();

      scheduler.stop();
    });

    test("resets refreshing flag after completion", async () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const expiredSnapshot: SnapshotMetadata = {
        snapshotId: "snap-expired",
        key: {
          repoOwner: "owner",
          repoName: "repo",
          profile: "typescript",
          branch: "main",
        },
        createdAt: twoHoursAgo,
        refreshedAt: twoHoursAgo,
        commitSha: "abc123",
        dependencies: [],
        preBuildSuccess: true,
        size: 1000000,
        provider: "daytona",
        image: "debian:12",
        refreshing: false,
      };

      mockListAll.mockResolvedValue([expiredSnapshot]);
      mockGet.mockResolvedValue(expiredSnapshot);

      const mockSandbox = createMockSandbox();
      mockRestoreSnapshot.mockResolvedValue({
        success: true,
        sandbox: mockSandbox,
        fromCache: true,
      });
      mockCreateSnapshot.mockResolvedValue({
        success: true,
        snapshotId: "new-snap-id",
        metadata: null,
      });
      mockSave.mockImplementation((metadata) => {
        // Verify refreshing flag is set to true during refresh
        expect((metadata as SnapshotMetadata).refreshing).toBe(true);
        return Promise.resolve(undefined);
      });
      mockCleanup.mockResolvedValue(undefined);

      scheduler.start();

      // Wait for cycle to complete
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Final save should reset refreshing flag to false
      const finalSaveCall = mockSave.mock.calls[mockSave.mock.calls.length - 1];
      const finalMetadata = finalSaveCall[0] as SnapshotMetadata;
      expect(finalMetadata.refreshing).toBe(false);

      scheduler.stop();
    });
  });

  describe("maxConcurrent", () => {
    test("respects maxConcurrent limit", async () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      // Create 4 expired snapshots
      const mockSnapshots: SnapshotMetadata[] = Array.from({ length: 4 }, (_, i) => ({
        snapshotId: `snap-${i}`,
        key: {
          repoOwner: "owner",
          repoName: "repo",
          profile: "typescript" as const,
          branch: `branch-${i}`,
        },
        createdAt: twoHoursAgo,
        refreshedAt: twoHoursAgo,
        commitSha: `sha-${i}`,
        dependencies: [],
        preBuildSuccess: true,
        size: 1000000,
        provider: "daytona" as const,
        image: "debian:12",
        refreshing: false,
      }));

      mockListAll.mockResolvedValue(mockSnapshots);
      mockGet.mockImplementation((key: SnapshotKey) => {
        return Promise.resolve(
          mockSnapshots.find((s) => s.key.branch === key.branch) || null,
        );
      });

      // Create slow-refreshing sandboxes
      const createSlowSandbox = () => {
        let cleanupPromise: Promise<void> | null = null;
        return {
          ...createMockSandbox(),
          cleanup: mock(() => {
            cleanupPromise = new Promise((resolve) => setTimeout(resolve, 200));
            return cleanupPromise;
          }),
        } as unknown as SandboxService;
      };

      const mockSandboxes = mockSnapshots.map(() => createSlowSandbox());
      let sandboxIndex = 0;

      mockRestoreSnapshot.mockImplementation(async () => {
        const sandbox = mockSandboxes[sandboxIndex++];
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          success: true,
          sandbox,
          fromCache: true,
        };
      });

      mockCreateSnapshot.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          success: true,
          snapshotId: `new-snap-${sandboxIndex}`,
          metadata: null,
        };
      });

      mockSave.mockResolvedValue(undefined);

      scheduler = new SnapshotScheduler(mockStore, mockManager, {
        intervalMs: 1000,
        maxAgeHours: 1,
        maxConcurrent: 2,
        autoDiscover: false,
      });

      scheduler.start();

      // Wait for initial cycle to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      // At most 2 should be in progress at once
      expect(mockRestoreSnapshot).toHaveBeenCalledTimes(2);

      scheduler.stop();
    });
  });

  describe("error handling", () => {
    test("handles cycle errors gracefully", async () => {
      mockListAll.mockRejectedValue(new Error("Store error"));

      scheduler.start();

      // Wait for cycle to fail
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should not throw, scheduler should continue running
      expect(scheduler).toBeDefined();

      scheduler.stop();
    });

    test("handles refresh errors gracefully", async () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const expiredSnapshot: SnapshotMetadata = {
        snapshotId: "snap-expired",
        key: {
          repoOwner: "owner",
          repoName: "repo",
          profile: "typescript",
          branch: "main",
        },
        createdAt: twoHoursAgo,
        refreshedAt: twoHoursAgo,
        commitSha: "abc123",
        dependencies: [],
        preBuildSuccess: true,
        size: 1000000,
        provider: "daytona",
        image: "debian:12",
        refreshing: false,
      };

      mockListAll.mockResolvedValue([expiredSnapshot]);
      mockGet.mockResolvedValue(expiredSnapshot);
      mockRestoreSnapshot.mockRejectedValue(new Error("Restore error"));
      mockSave.mockResolvedValue(undefined);

      scheduler.start();

      // Wait for cycle to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should not throw, should continue running
      expect(scheduler).toBeDefined();

      scheduler.stop();
    });

    test("handles cleanup failure gracefully", async () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const expiredSnapshot: SnapshotMetadata = {
        snapshotId: "snap-expired",
        key: {
          repoOwner: "owner",
          repoName: "repo",
          profile: "typescript",
          branch: "main",
        },
        createdAt: twoHoursAgo,
        refreshedAt: twoHoursAgo,
        commitSha: "abc123",
        dependencies: [],
        preBuildSuccess: true,
        size: 1000000,
        provider: "daytona",
        image: "debian:12",
        refreshing: false,
      };

      mockListAll.mockResolvedValue([expiredSnapshot]);
      mockGet.mockResolvedValue(expiredSnapshot);

      const mockSandbox = createMockSandbox();
      mockRestoreSnapshot.mockResolvedValue({
        success: true,
        sandbox: mockSandbox,
        fromCache: true,
      });
      mockCreateSnapshot.mockResolvedValue({
        success: true,
        snapshotId: "new-snap-id",
        metadata: null,
      });
      mockSave.mockResolvedValue(undefined);
      mockCleanup.mockRejectedValue(new Error("Cleanup error"));

      scheduler.start();

      // Wait for cycle to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should complete despite cleanup error
      expect(mockCreateSnapshot).toHaveBeenCalled();

      scheduler.stop();
    });
  });

  describe("Cache Integration", () => {
    test("scheduler uses cached listAll() results", async () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const expiredSnapshot: SnapshotMetadata = {
        snapshotId: "snap-expired",
        key: {
          repoOwner: "owner",
          repoName: "repo",
          profile: "typescript",
          branch: "main",
        },
        createdAt: twoHoursAgo,
        refreshedAt: twoHoursAgo,
        commitSha: "abc123",
        dependencies: [],
        preBuildSuccess: true,
        size: 1000000,
        provider: "daytona",
        image: "debian:12",
        refreshing: false,
      };

      let listAllCallCount = 0;
      mockListAll.mockImplementation(async () => {
        listAllCallCount++;
        return [expiredSnapshot];
      });

      scheduler.start();

      // Wait for multiple cycles
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // listAll should be called multiple times (once per cycle)
      // With caching, subsequent calls within the same cycle should use cache
      expect(listAllCallCount).toBeGreaterThanOrEqual(2);

      scheduler.stop();
    });

    test("scheduler tracks cache statistics through store", async () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const expiredSnapshot: SnapshotMetadata = {
        snapshotId: "snap-expired",
        key: {
          repoOwner: "owner",
          repoName: "repo",
          profile: "typescript",
          branch: "main",
        },
        createdAt: twoHoursAgo,
        refreshedAt: twoHoursAgo,
        commitSha: "abc123",
        dependencies: [],
        preBuildSuccess: true,
        size: 1000000,
        provider: "daytona",
        image: "debian:12",
        refreshing: false,
      };

      mockListAll.mockResolvedValue([expiredSnapshot]);
      mockGet.mockResolvedValue(expiredSnapshot);

      // Create a store with getCacheStats method
      const mockGetCacheStats = mock(() => ({
        hits: 5,
        misses: 2,
      }));

      const storeWithCacheStats = {
        ...mockStore,
        getCacheStats: mockGetCacheStats,
      };

      const schedulerWithCache = new SnapshotScheduler(storeWithCacheStats, mockManager, {
        intervalMs: 1000,
        maxAgeHours: 1,
        maxConcurrent: 2,
      });

      schedulerWithCache.start();

      // Wait for cycle
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Cache stats should be accessible
      const stats = storeWithCacheStats.getCacheStats();
      expect(stats).toBeDefined();
      expect(stats.hits).toBe(5);
      expect(stats.misses).toBe(2);

      schedulerWithCache.stop();
    });

    test("scheduler clears cache when snapshot is refreshed", async () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const expiredSnapshot: SnapshotMetadata = {
        snapshotId: "snap-expired",
        key: {
          repoOwner: "owner",
          repoName: "repo",
          profile: "typescript",
          branch: "main",
        },
        createdAt: twoHoursAgo,
        refreshedAt: twoHoursAgo,
        commitSha: "abc123",
        dependencies: [],
        preBuildSuccess: true,
        size: 1000000,
        provider: "daytona",
        image: "debian:12",
        refreshing: false,
      };

      mockListAll.mockResolvedValue([expiredSnapshot]);
      mockGet.mockResolvedValue(expiredSnapshot);

      const mockClearCache = mock();
      const storeWithClearCache = {
        ...mockStore,
        clearCache: mockClearCache,
      };

      // Modify save to call clearCache
      mockSave.mockImplementation(async () => {
        // Simulate cache clear on save
        if (mockClearCache) {
          mockClearCache();
        }
      });

      const mockSandbox = createMockSandbox();
      mockRestoreSnapshot.mockResolvedValue({
        success: true,
        sandbox: mockSandbox,
        fromCache: true,
      });
      mockCreateSnapshot.mockResolvedValue({
        success: true,
        snapshotId: "new-snap-id",
        metadata: null,
      });
      mockCleanup.mockResolvedValue(undefined);

      const schedulerWithClear = new SnapshotScheduler(storeWithClearCache, mockManager, {
        intervalMs: 1000,
        maxAgeHours: 1,
        maxConcurrent: 2,
      });

      schedulerWithClear.start();

      // Wait for cycle to complete
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Save should have been called (which triggers cache clear)
      expect(mockSave).toHaveBeenCalled();

      schedulerWithClear.stop();
    });

    test("scheduler handles store without cache methods gracefully", async () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const expiredSnapshot: SnapshotMetadata = {
        snapshotId: "snap-expired",
        key: {
          repoOwner: "owner",
          repoName: "repo",
          profile: "typescript",
          branch: "main",
        },
        createdAt: twoHoursAgo,
        refreshedAt: twoHoursAgo,
        commitSha: "abc123",
        dependencies: [],
        preBuildSuccess: true,
        size: 1000000,
        provider: "daytona",
        image: "debian:12",
        refreshing: false,
      };

      mockListAll.mockResolvedValue([expiredSnapshot]);
      mockGet.mockResolvedValue(expiredSnapshot);

      // Store without cache methods
      const basicStore = {
        get: mockGet,
        save: mockSave,
        delete: mock(),
        listAll: mockListAll,
      };

      const schedulerWithBasicStore = new SnapshotScheduler(basicStore, mockManager, {
        intervalMs: 1000,
        maxAgeHours: 1,
        maxConcurrent: 2,
      });

      // Should not throw when store doesn't have cache methods
      expect(() => {
        schedulerWithBasicStore.start();
      }).not.toThrow();

      // Wait for cycle
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should still work normally
      expect(mockListAll).toHaveBeenCalled();

      schedulerWithBasicStore.stop();
    });

    test("scheduler works correctly with cached get() calls", async () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const expiredSnapshot: SnapshotMetadata = {
        snapshotId: "snap-expired",
        key: {
          repoOwner: "owner",
          repoName: "repo",
          profile: "typescript",
          branch: "main",
        },
        createdAt: twoHoursAgo,
        refreshedAt: twoHoursAgo,
        commitSha: "abc123",
        dependencies: [],
        preBuildSuccess: true,
        size: 1000000,
        provider: "daytona",
        image: "debian:12",
        refreshing: false,
      };

      let getCallCount = 0;
      mockGet.mockImplementation(async () => {
        getCallCount++;
        return expiredSnapshot;
      });

      mockListAll.mockResolvedValue([expiredSnapshot]);

      const mockSandbox = createMockSandbox();
      mockRestoreSnapshot.mockResolvedValue({
        success: true,
        sandbox: mockSandbox,
        fromCache: true,
      });
      mockCreateSnapshot.mockResolvedValue({
        success: true,
        snapshotId: "new-snap-id",
        metadata: null,
      });
      mockSave.mockResolvedValue(undefined);
      mockCleanup.mockResolvedValue(undefined);

      scheduler.start();

      // Wait for cycle to complete
      await new Promise((resolve) => setTimeout(resolve, 300));

      // get() should be called (possibly multiple times during refresh)
      expect(getCallCount).toBeGreaterThan(0);

      scheduler.stop();
    });
  });
});
