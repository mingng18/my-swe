/**
 * Snapshot Scheduler
 *
 * Background scheduler that keeps snapshots fresh by periodically:
 * 1. Pulling latest changes from the repository
 * 2. Reinstalling dependencies if they changed
 * 3. Re-running pre-build steps
 * 4. Updating snapshot metadata
 *
 * This ensures snapshots are always ready for instant restore.
 *
 * References:
 * - Internal enterprise transformation plan (Phase 2)
 */

import { createLogger } from "../utils/logger";
import { SnapshotManager } from "./snapshot-manager";
import type { SandboxProfile } from "../integrations/daytona-pool";
import type { SandboxService } from "../integrations/sandbox-service";
import type {
  SnapshotMetadata,
  SnapshotKey,
  SnapshotStore,
} from "./snapshot-metadata";

const logger = createLogger("snapshot-scheduler");

/**
 * Scheduler configuration.
 */
export interface SchedulerConfig {
  /** Interval between refresh cycles (milliseconds) */
  intervalMs: number;

  /** Maximum age of a snapshot before refresh (hours) */
  maxAgeHours: number;

  /** Maximum concurrent refreshes */
  maxConcurrent: number;

  /** Whether to automatically detect and create new snapshots */
  autoDiscover: boolean;
}

/**
 * Default scheduler configuration.
 */
export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  intervalMs: 30 * 60 * 1000, // 30 minutes
  maxAgeHours: 48, // 2 days
  maxConcurrent: 3,
  autoDiscover: true,
};

/**
 * Snapshot refresh task.
 */
interface RefreshTask {
  key: SnapshotKey;
  priority: number;
  scheduledAt: Date;
}

/**
 * Snapshot scheduler for background refresh.
 */
export class SnapshotScheduler {
  private config: SchedulerConfig;
  private store: SnapshotStore;
  private manager: SnapshotManager;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private queue: RefreshTask[] = [];
  private activeRefreshes = 0;

  constructor(
    store: SnapshotStore,
    manager: SnapshotManager,
    config: Partial<SchedulerConfig> = {},
  ) {
    this.store = store;
    this.manager = manager;
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
  }

  /**
   * Start the background scheduler.
   */
  start(): void {
    if (this.running) {
      logger.warn(`[snapshot-scheduler] Already running`);
      return;
    }

    this.running = true;
    logger.info(
      {
        intervalMs: this.config.intervalMs,
        maxAgeHours: this.config.maxAgeHours,
      },
      `[snapshot-scheduler] Starting`,
    );

    this.intervalId = setInterval(() => {
      this.runCycle().catch((error) => {
        logger.error({ error }, `[snapshot-scheduler] Cycle failed`);
      });
    }, this.config.intervalMs);

    // Run initial cycle
    this.runCycle().catch((error) => {
      logger.error({ error }, `[snapshot-scheduler] Initial cycle failed`);
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

    logger.info(`[snapshot-scheduler] Stopped`);
  }

  /**
   * Run a single refresh cycle.
   */
  private async runCycle(): Promise<void> {
    logger.debug(`[snapshot-scheduler] Starting refresh cycle`);

    // 1. Find snapshots that need refresh
    const expiredSnapshots = await this.findExpiredSnapshots();

    // 2. Add to queue (sorted by priority)
    for (const snapshot of expiredSnapshots) {
      this.queue.push({
        key: snapshot.key,
        priority: this.calculatePriority(snapshot),
        scheduledAt: new Date(),
      });
    }

    // Sort queue by priority (higher first)
    this.queue.sort((a, b) => b.priority - a.priority);

    // 3. Process queue up to max concurrent
    while (
      this.queue.length > 0 &&
      this.activeRefreshes < this.config.maxConcurrent
    ) {
      const task = this.queue.shift();
      if (!task) break;

      this.activeRefreshes++;
      this.refreshSnapshot(task.key)
        .catch((error) => {
          logger.error(
            { error, key: task.key },
            `[snapshot-scheduler] Refresh failed`,
          );
        })
        .finally(() => {
          this.activeRefreshes--;
        });
    }

    logger.debug(
      {
        queued: this.queue.length,
        active: this.activeRefreshes,
        refreshed: expiredSnapshots.length,
      },
      `[snapshot-scheduler] Cycle complete`,
    );
  }

  /**
   * Find snapshots that need refresh based on max age.
   */
  private async findExpiredSnapshots(): Promise<SnapshotMetadata[]> {
    const allSnapshots: SnapshotMetadata[] = [];
    const expired: SnapshotMetadata[] = [];

    // Get all snapshots from the store
    // Note: This requires the store to have a listAll method or similar
    // For now, we'll use the cleanup method to get an idea

    // TODO: Implement listAll in SnapshotStore
    // For now, return empty array
    return expired;
  }

  /**
   * Calculate refresh priority for a snapshot.
   * Higher priority = should be refreshed sooner.
   */
  private calculatePriority(snapshot: SnapshotMetadata): number {
    let priority = 0;

    // Base priority on age (older = higher priority)
    const ageMs = Date.now() - snapshot.refreshedAt.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    priority += ageHours * 10;

    // Boost priority for commonly used profiles
    if (
      snapshot.key.profile === "typescript" ||
      snapshot.key.profile === "javascript"
    ) {
      priority += 5;
    }

    // Boost priority for main branch
    if (snapshot.key.branch === "main" || snapshot.key.branch === "master") {
      priority += 10;
    }

    return priority;
  }

  /**
   * Refresh a single snapshot.
   */
  private async refreshSnapshot(key: SnapshotKey): Promise<void> {
    logger.debug({ key }, `[snapshot-scheduler] Refreshing snapshot`);

    // TODO: Implement actual refresh logic
    // This would:
    // 1. Acquire a sandbox with the correct profile
    // 2. Pull latest changes
    // 3. Reinstall dependencies if changed
    // 4. Update snapshot metadata

    logger.debug(
      { key },
      `[snapshot-scheduler] Refresh complete (not yet implemented)`,
    );
  }
}

/**
 * Global snapshot scheduler instance.
 */
export let globalSnapshotScheduler: SnapshotScheduler | null = null;

/**
 * Initialize and start the global snapshot scheduler.
 */
export async function startSnapshotScheduler(
  store: SnapshotStore,
  manager: SnapshotManager,
  config?: Partial<SchedulerConfig>,
): Promise<void> {
  if (globalSnapshotScheduler) {
    logger.warn(`[snapshot-scheduler] Already initialized`);
    return;
  }

  globalSnapshotScheduler = new SnapshotScheduler(store, manager, config);
  globalSnapshotScheduler.start();

  logger.info(`[snapshot-scheduler] Global scheduler started`);
}

/**
 * Stop the global snapshot scheduler.
 */
export function stopSnapshotScheduler(): void {
  if (globalSnapshotScheduler) {
    globalSnapshotScheduler.stop();
    globalSnapshotScheduler = null;
  }
}
