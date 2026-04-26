/**
 * Thread Cleanup Scheduler
 *
 * Background scheduler that prevents memory leaks by periodically:
 * 1. Scanning thread-scoped maps for inactive threads
 * 2. Removing entries older than the configured TTL
 * 3. Cleaning up associated resources (agents, sandboxes, repos)
 *
 * This ensures long-running deployments don't accumulate unbounded thread state.
 *
 * References:
 * - Internal enterprise transformation plan (Phase 2)
 * - Thread cleanup implementation plan (subtask-1-1)
 */

import { createLogger } from "../utils/logger";

const logger = createLogger("thread-cleanup-scheduler");

/**
 * Scheduler configuration.
 */
export interface ThreadCleanupSchedulerConfig {
  /** Interval between cleanup cycles (milliseconds) */
  intervalMs: number;

  /** Maximum age of thread entry before cleanup (milliseconds) */
  ttlMs: number;

  /** Whether cleanup is enabled */
  enabled: boolean;
}

/**
 * Default scheduler configuration.
 */
export const DEFAULT_THREAD_CLEANUP_CONFIG: ThreadCleanupSchedulerConfig = {
  intervalMs: 60 * 60 * 1000, // 1 hour
  ttlMs: 24 * 60 * 60 * 1000, // 24 hours
  enabled: true,
};

/**
 * Thread metadata for tracking last access time.
 */
export interface ThreadMetadata {
  threadId: string;
  lastAccessed: Date;
}

/**
 * Cleanup statistics.
 */
export interface CleanupStats {
  cleanedAgents: number;
  cleanedSandboxes: number;
  cleanedRepos: number;
  totalEntriesBefore: number;
  totalEntriesAfter: number;
  cycleDurationMs: number;
}

/**
 * Cleanup function interface.
 * Implementations should remove entries older than the TTL.
 */
export interface ThreadMapCleanupFn {
  (metadata: Map<string, ThreadMetadata>, ttlMs: number): Promise<number>;
}

/**
 * Thread cleanup scheduler for background memory management.
 */
export class ThreadCleanupScheduler {
  private config: ThreadCleanupSchedulerConfig;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private metadataStore: Map<string, ThreadMetadata> = new Map();
  private cleanupFns: ThreadMapCleanupFn[] = [];

  constructor(config: Partial<ThreadCleanupSchedulerConfig> = {}) {
    this.config = { ...DEFAULT_THREAD_CLEANUP_CONFIG, ...config };
  }

  /**
   * Register a cleanup function to be called during each cycle.
   */
  registerCleanupFn(fn: ThreadMapCleanupFn): void {
    this.cleanupFns.push(fn);
  }

  /**
   * Update the last accessed time for a thread.
   */
  markAccessed(threadId: string): void {
    this.metadataStore.set(threadId, {
      threadId,
      lastAccessed: new Date(),
    });
  }

  /**
   * Remove a thread from tracking.
   */
  removeThread(threadId: string): void {
    this.metadataStore.delete(threadId);
  }

  /**
   * Start the background scheduler.
   */
  start(): void {
    if (!this.config.enabled) {
      logger.info(`[thread-cleanup-scheduler] Cleanup disabled, not starting`);
      return;
    }

    if (this.running) {
      logger.warn(`[thread-cleanup-scheduler] Already running`);
      return;
    }

    this.running = true;
    logger.info(
      {
        intervalMs: this.config.intervalMs,
        ttlMs: this.config.ttlMs,
      },
      `[thread-cleanup-scheduler] Starting`,
    );

    this.intervalId = setInterval(() => {
      this.runCycle().catch((error) => {
        logger.error({ error }, `[thread-cleanup-scheduler] Cycle failed`);
      });
    }, this.config.intervalMs);

    // Run initial cycle
    this.runCycle().catch((error) => {
      logger.error({ error }, `[thread-cleanup-scheduler] Initial cycle failed`);
    });
  }

  /**
   * Stop the background scheduler.
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    logger.info(`[thread-cleanup-scheduler] Stopped`);
  }

  /**
   * Run a single cleanup cycle.
   */
  private async runCycle(): Promise<CleanupStats> {
    const startTime = Date.now();
    logger.debug(`[thread-cleanup-scheduler] Starting cleanup cycle`);

    const stats: CleanupStats = {
      cleanedAgents: 0,
      cleanedSandboxes: 0,
      cleanedRepos: 0,
      totalEntriesBefore: this.metadataStore.size,
      totalEntriesAfter: 0,
      cycleDurationMs: 0,
    };

    try {
      // Find expired threads
      const expiredThreads = this.findExpiredThreads();

      if (expiredThreads.length > 0) {
        logger.info(
          {
            count: expiredThreads.length,
            threads: expiredThreads.map((t) => t.threadId),
          },
          `[thread-cleanup-scheduler] Found expired threads`,
        );
      }

      // Run registered cleanup functions
      for (const cleanupFn of this.cleanupFns) {
        try {
          const cleaned = await cleanupFn(
            this.metadataStore,
            this.config.ttlMs,
          );
          // Track total cleaned (we don't know which map cleaned what)
          stats.cleanedAgents += cleaned;
        } catch (error) {
          logger.error(
            { error },
            `[thread-cleanup-scheduler] Cleanup function failed`,
          );
        }
      }

      // Remove expired threads from metadata store
      for (const thread of expiredThreads) {
        this.metadataStore.delete(thread.threadId);
      }

      stats.totalEntriesAfter = this.metadataStore.size;
      stats.cycleDurationMs = Date.now() - startTime;

      if (expiredThreads.length > 0) {
        logger.info(
          {
            cleaned: expiredThreads.length,
            remaining: stats.totalEntriesAfter,
            durationMs: stats.cycleDurationMs,
          },
          `[thread-cleanup-scheduler] Cleanup complete`,
        );
      } else {
        logger.debug(
          {
            durationMs: stats.cycleDurationMs,
          },
          `[thread-cleanup-scheduler] Cleanup complete (no expired threads)`,
        );
      }
    } catch (error) {
      stats.cycleDurationMs = Date.now() - startTime;
      logger.error({ error }, `[thread-cleanup-scheduler] Cycle failed`);
    }

    return stats;
  }

  /**
   * Find threads that have exceeded the TTL.
   */
  private findExpiredThreads(): ThreadMetadata[] {
    const now = Date.now();
    const expired: ThreadMetadata[] = [];

    for (const [threadId, metadata] of this.metadataStore.entries()) {
      const ageMs = now - metadata.lastAccessed.getTime();
      if (ageMs > this.config.ttlMs) {
        expired.push(metadata);
      }
    }

    return expired;
  }

  /**
   * Get current metadata store (for testing/inspection).
   */
  getMetadata(): Map<string, ThreadMetadata> {
    return new Map(this.metadataStore);
  }

  /**
   * Get current configuration.
   */
  getConfig(): ThreadCleanupSchedulerConfig {
    return { ...this.config };
  }

  /**
   * Check if scheduler is running.
   */
  isRunning(): boolean {
    return this.running;
  }
}

/**
 * Global thread cleanup scheduler instance.
 */
export let globalThreadCleanupScheduler: ThreadCleanupScheduler | null = null;

/**
 * Initialize and start the global thread cleanup scheduler.
 */
export function startThreadCleanupScheduler(
  config?: Partial<ThreadCleanupSchedulerConfig>,
): ThreadCleanupScheduler {
  if (globalThreadCleanupScheduler) {
    logger.warn(`[thread-cleanup-scheduler] Already initialized`);
    return globalThreadCleanupScheduler;
  }

  globalThreadCleanupScheduler = new ThreadCleanupScheduler(config);
  globalThreadCleanupScheduler.start();

  logger.info(`[thread-cleanup-scheduler] Global scheduler started`);
  return globalThreadCleanupScheduler;
}

/**
 * Stop the global thread cleanup scheduler.
 */
export function stopThreadCleanupScheduler(): void {
  if (globalThreadCleanupScheduler) {
    globalThreadCleanupScheduler.stop();
    globalThreadCleanupScheduler = null;
  }
}

/**
 * Get the global thread cleanup scheduler instance.
 */
export function getThreadCleanupScheduler(): ThreadCleanupScheduler | null {
  return globalThreadCleanupScheduler;
}
