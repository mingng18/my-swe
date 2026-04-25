import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  ThreadCleanupScheduler,
  DEFAULT_THREAD_CLEANUP_CONFIG,
  startThreadCleanupScheduler,
  stopThreadCleanupScheduler,
  getThreadCleanupScheduler,
  type ThreadCleanupSchedulerConfig,
  type ThreadMetadata,
  type ThreadMapCleanupFn,
} from "../thread-cleanup-scheduler";

describe("ThreadCleanupScheduler", () => {
  let scheduler: ThreadCleanupScheduler;

  beforeEach(() => {
    // Reset global state
    stopThreadCleanupScheduler();
    scheduler = new ThreadCleanupScheduler({
      intervalMs: 100, // Short interval for testing
      ttlMs: 1000, // 1 second TTL
      enabled: true,
    });
  });

  afterEach(() => {
    scheduler.stop();
    stopThreadCleanupScheduler();
  });

  describe("constructor", () => {
    it("should use default config when no config provided", () => {
      const defaultScheduler = new ThreadCleanupScheduler();
      const config = defaultScheduler.getConfig();

      expect(config.intervalMs).toBe(DEFAULT_THREAD_CLEANUP_CONFIG.intervalMs);
      expect(config.ttlMs).toBe(DEFAULT_THREAD_CLEANUP_CONFIG.ttlMs);
      expect(config.enabled).toBe(DEFAULT_THREAD_CLEANUP_CONFIG.enabled);
    });

    it("should merge partial config with defaults", () => {
      const partialConfigScheduler = new ThreadCleanupScheduler({
        intervalMs: 5000,
      });
      const config = partialConfigScheduler.getConfig();

      expect(config.intervalMs).toBe(5000);
      expect(config.ttlMs).toBe(DEFAULT_THREAD_CLEANUP_CONFIG.ttlMs);
      expect(config.enabled).toBe(DEFAULT_THREAD_CLEANUP_CONFIG.enabled);
    });

    it("should accept complete config override", () => {
      const customConfig: ThreadCleanupSchedulerConfig = {
        intervalMs: 1000,
        ttlMs: 5000,
        enabled: false,
      };
      const customScheduler = new ThreadCleanupScheduler(customConfig);
      const config = customScheduler.getConfig();

      expect(config.intervalMs).toBe(1000);
      expect(config.ttlMs).toBe(5000);
      expect(config.enabled).toBe(false);
    });

    it("should start in not running state", () => {
      expect(scheduler.isRunning()).toBe(false);
    });
  });

  describe("markAccessed", () => {
    it("should add new thread to metadata store", () => {
      scheduler.markAccessed("thread-1");

      const metadata = scheduler.getMetadata();
      expect(metadata.size).toBe(1);
      expect(metadata.has("thread-1")).toBe(true);
    });

    it("should update last accessed time for existing thread", async () => {
      scheduler.markAccessed("thread-1");

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      scheduler.markAccessed("thread-1");

      const metadata = scheduler.getMetadata();
      expect(metadata.size).toBe(1); // Still only one entry
      expect(metadata.has("thread-1")).toBe(true);
    });

    it("should track multiple threads independently", () => {
      scheduler.markAccessed("thread-1");
      scheduler.markAccessed("thread-2");
      scheduler.markAccessed("thread-3");

      const metadata = scheduler.getMetadata();
      expect(metadata.size).toBe(3);
      expect(metadata.has("thread-1")).toBe(true);
      expect(metadata.has("thread-2")).toBe(true);
      expect(metadata.has("thread-3")).toBe(true);
    });
  });

  describe("removeThread", () => {
    it("should remove thread from metadata store", () => {
      scheduler.markAccessed("thread-1");
      expect(scheduler.getMetadata().size).toBe(1);

      scheduler.removeThread("thread-1");
      expect(scheduler.getMetadata().size).toBe(0);
    });

    it("should handle removing non-existent thread gracefully", () => {
      expect(() => scheduler.removeThread("non-existent")).not.toThrow();
      expect(scheduler.getMetadata().size).toBe(0);
    });

    it("should only remove specified thread", () => {
      scheduler.markAccessed("thread-1");
      scheduler.markAccessed("thread-2");
      scheduler.markAccessed("thread-3");

      scheduler.removeThread("thread-2");

      const metadata = scheduler.getMetadata();
      expect(metadata.size).toBe(2);
      expect(metadata.has("thread-1")).toBe(true);
      expect(metadata.has("thread-2")).toBe(false);
      expect(metadata.has("thread-3")).toBe(true);
    });
  });

  describe("registerCleanupFn", () => {
    it("should register cleanup function", async () => {
      let called = false;
      const cleanupFn: ThreadMapCleanupFn = async () => {
        called = true;
        return 1;
      };

      scheduler.registerCleanupFn(cleanupFn);

      // Manually trigger cleanup by marking threads and waiting for expiry
      scheduler.markAccessed("thread-1");

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Start and wait for cycle
      scheduler.start();
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(called).toBe(true);
    });

    it("should register multiple cleanup functions", async () => {
      let callCount = 0;
      const cleanupFn1: ThreadMapCleanupFn = async () => {
        callCount++;
        return 1;
      };
      const cleanupFn2: ThreadMapCleanupFn = async () => {
        callCount++;
        return 2;
      };

      scheduler.registerCleanupFn(cleanupFn1);
      scheduler.registerCleanupFn(cleanupFn2);

      // Create expired thread
      scheduler.markAccessed("thread-1");
      await new Promise((resolve) => setTimeout(resolve, 1100));

      scheduler.start();
      // Wait for initial cycle only (less than interval)
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have called both functions once (initial cycle)
      expect(callCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe("start", () => {
    it("should start the scheduler", () => {
      expect(scheduler.isRunning()).toBe(false);

      scheduler.start();

      expect(scheduler.isRunning()).toBe(true);
    });

    it("should not start when disabled", () => {
      const disabledScheduler = new ThreadCleanupScheduler({
        enabled: false,
      });

      disabledScheduler.start();

      expect(disabledScheduler.isRunning()).toBe(false);
    });

    it("should handle start when already running", () => {
      scheduler.start();

      expect(() => scheduler.start()).not.toThrow();
      expect(scheduler.isRunning()).toBe(true);
    });
  });

  describe("stop", () => {
    it("should stop the scheduler", () => {
      scheduler.start();
      expect(scheduler.isRunning()).toBe(true);

      scheduler.stop();

      expect(scheduler.isRunning()).toBe(false);
    });

    it("should handle stop when not running", () => {
      expect(() => scheduler.stop()).not.toThrow();
      expect(scheduler.isRunning()).toBe(false);
    });

    it("should handle multiple stops", () => {
      scheduler.start();
      scheduler.stop();

      expect(() => scheduler.stop()).not.toThrow();
      expect(scheduler.isRunning()).toBe(false);
    });
  });

  describe("cleanup cycle behavior", () => {
    it("should remove expired threads from metadata store", async () => {
      scheduler.markAccessed("thread-1");
      scheduler.markAccessed("thread-2");

      expect(scheduler.getMetadata().size).toBe(2);

      // Wait for threads to expire (TTL is 1000ms)
      await new Promise((resolve) => setTimeout(resolve, 1100));

      scheduler.start();

      // Wait for cleanup cycle to run (interval is 100ms)
      await new Promise((resolve) => setTimeout(resolve, 200));

      const metadata = scheduler.getMetadata();
      expect(metadata.size).toBe(0);
    });

    it("should not remove active threads", async () => {
      scheduler.markAccessed("thread-1");

      // Wait a bit but not past TTL
      await new Promise((resolve) => setTimeout(resolve, 500));

      scheduler.markAccessed("thread-1"); // Refresh thread-1

      // Wait past original TTL but thread was refreshed less than 1000ms ago
      await new Promise((resolve) => setTimeout(resolve, 600));

      scheduler.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const metadata = scheduler.getMetadata();
      // Thread should still be there since we refreshed it
      expect(metadata.size).toBe(1);
      expect(metadata.has("thread-1")).toBe(true);
    });

    it("should call registered cleanup functions", async () => {
      let cleanupCalled = false;
      let cleanedCount = 0;

      const cleanupFn: ThreadMapCleanupFn = async (
        metadata: Map<string, ThreadMetadata>,
        ttlMs: number,
      ) => {
        cleanupCalled = true;
        cleanedCount = metadata.size;
        return cleanedCount;
      };

      scheduler.registerCleanupFn(cleanupFn);
      scheduler.markAccessed("thread-1");

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 1100));

      scheduler.start();
      // Wait for initial cycle only (less than interval)
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(cleanupCalled).toBe(true);
      expect(cleanedCount).toBeGreaterThanOrEqual(1);
    });

    it("should handle cleanup function errors gracefully", async () => {
      const errorFn: ThreadMapCleanupFn = async () => {
        throw new Error("Cleanup failed");
      };

      scheduler.registerCleanupFn(errorFn);
      scheduler.markAccessed("thread-1");

      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should not throw
      expect(() => {
        scheduler.start();
      }).not.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 200));
    });
  });

  describe("getMetadata", () => {
    it("should return copy of metadata store", () => {
      scheduler.markAccessed("thread-1");

      const metadata1 = scheduler.getMetadata();
      const metadata2 = scheduler.getMetadata();

      expect(metadata1.size).toBe(1);
      expect(metadata2.size).toBe(1);

      // Modifying returned map should not affect internal store
      metadata1.clear();

      expect(scheduler.getMetadata().size).toBe(1);
    });

    it("should return empty map when no threads tracked", () => {
      const metadata = scheduler.getMetadata();
      expect(metadata.size).toBe(0);
    });
  });

  describe("getConfig", () => {
    it("should return copy of config", () => {
      const config1 = scheduler.getConfig();
      const config2 = scheduler.getConfig();

      expect(config1).toEqual(config2);

      // Modifying returned config should not affect internal config
      config1.intervalMs = 99999;

      expect(scheduler.getConfig().intervalMs).not.toBe(99999);
    });
  });

  describe("isRunning", () => {
    it("should return false initially", () => {
      expect(scheduler.isRunning()).toBe(false);
    });

    it("should return true after start", () => {
      scheduler.start();
      expect(scheduler.isRunning()).toBe(true);
    });

    it("should return false after stop", () => {
      scheduler.start();
      scheduler.stop();
      expect(scheduler.isRunning()).toBe(false);
    });
  });
});

describe("Global thread cleanup scheduler", () => {
  afterEach(() => {
    stopThreadCleanupScheduler();
  });

  describe("startThreadCleanupScheduler", () => {
    it("should create and start global scheduler", () => {
      const scheduler = startThreadCleanupScheduler({
        intervalMs: 1000,
        ttlMs: 5000,
        enabled: true,
      });

      expect(scheduler).not.toBeNull();
      expect(scheduler.isRunning()).toBe(true);
      expect(getThreadCleanupScheduler()).toBe(scheduler);
    });

    it("should return existing scheduler if already initialized", () => {
      const scheduler1 = startThreadCleanupScheduler();
      const scheduler2 = startThreadCleanupScheduler();

      expect(scheduler1).toBe(scheduler2);
    });

    it("should not start when disabled", () => {
      const scheduler = startThreadCleanupScheduler({
        enabled: false,
      });

      expect(scheduler.isRunning()).toBe(false);
    });
  });

  describe("stopThreadCleanupScheduler", () => {
    it("should stop and clear global scheduler", () => {
      startThreadCleanupScheduler();

      stopThreadCleanupScheduler();

      expect(getThreadCleanupScheduler()).toBeNull();
    });

    it("should handle stopping when not initialized", () => {
      expect(() => stopThreadCleanupScheduler()).not.toThrow();
    });
  });

  describe("getThreadCleanupScheduler", () => {
    it("should return null when not initialized", () => {
      expect(getThreadCleanupScheduler()).toBeNull();
    });

    it("should return scheduler after initialization", () => {
      const scheduler = startThreadCleanupScheduler();
      expect(getThreadCleanupScheduler()).toBe(scheduler);
    });
  });
});
