import { createLogger } from "../utils/logger";
import { MemoryRepository } from "./repository";
import { ConsolidationService } from "./consolidation";
import { EmbeddingService } from "./embeddings";

const logger = createLogger("memory-daemon");

/**
 * Default consolidation interval in milliseconds (6 hours)
 */
const DEFAULT_CONSOLIDATION_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Session registration for tracking active threads
 */
interface SessionRegistration {
  threadId: string;
  registeredAt: Date;
  lastActivityAt: Date;
}

/**
 * Daemon status information
 */
interface DaemonStatus {
  isRunning: boolean;
  consolidationInterval: number;
  lastConsolidationAt?: Date;
  nextConsolidationAt?: Date;
  registeredSessions: number;
  totalConsolidations: number;
  totalErrors: number;
}

/**
 * Background daemon for periodic memory consolidation
 */
export class MemoryDaemon {
  private static instance: MemoryDaemon | null = null;

  private isRunning = false;
  private consolidationTimer: NodeJS.Timeout | null = null;
  private repository: MemoryRepository;
  private consolidationService: ConsolidationService;
  private embeddingService: EmbeddingService;
  private consolidationInterval: number;
  private sessions: Map<string, SessionRegistration> = new Map();
  private lastConsolidationAt: Date | null = null;
  private totalConsolidations = 0;
  private totalErrors = 0;

  private constructor(
    repository?: MemoryRepository,
    consolidationService?: ConsolidationService,
    embeddingService?: EmbeddingService,
    consolidationInterval?: number,
  ) {
    this.repository = repository || new MemoryRepository();
    this.embeddingService = embeddingService || new EmbeddingService();

    // Create consolidation service with proper embedding interface
    if (consolidationService) {
      this.consolidationService = consolidationService;
    } else {
      // Create embedding service interface
      const embeddingInterface = {
        generateEmbedding: (text: string) =>
          this.embeddingService.generateEmbedding(text),
        cosineSimilarity: (a: number[], b: number[]) =>
          EmbeddingService.cosineSimilarity(a, b),
      };
      this.consolidationService = new ConsolidationService(
        this.repository,
        embeddingInterface,
      );
    }

    this.consolidationInterval =
      consolidationInterval || DEFAULT_CONSOLIDATION_INTERVAL_MS;
  }

  /**
   * Get the singleton instance of the MemoryDaemon
   */
  static getInstance(
    repository?: MemoryRepository,
    consolidationService?: ConsolidationService,
    embeddingService?: EmbeddingService,
    consolidationInterval?: number,
  ): MemoryDaemon {
    if (!MemoryDaemon.instance) {
      MemoryDaemon.instance = new MemoryDaemon(
        repository,
        consolidationService,
        embeddingService,
        consolidationInterval,
      );
    }
    return MemoryDaemon.instance;
  }

  /**
   * Start the daemon
   */
  start(): void {
    if (this.isRunning) {
      logger.warn("Daemon is already running");
      return;
    }

    this.isRunning = true;
    this.scheduleNextConsolidation();

    logger.info(
      {
        interval: this.consolidationInterval,
        nextRun: this.getNextConsolidationTime(),
      },
      "Memory daemon started",
    );
  }

  /**
   * Stop the daemon
   */
  stop(): void {
    if (!this.isRunning) {
      logger.warn("Daemon is not running");
      return;
    }

    this.isRunning = false;

    if (this.consolidationTimer) {
      clearTimeout(this.consolidationTimer);
      this.consolidationTimer = null;
    }

    logger.info("Memory daemon stopped");
  }

  /**
   * Register a session for consolidation tracking
   */
  registerSession(threadId: string): void {
    const existing = this.sessions.get(threadId);

    if (existing) {
      // Update last activity time
      existing.lastActivityAt = new Date();
    } else {
      // Register new session
      this.sessions.set(threadId, {
        threadId,
        registeredAt: new Date(),
        lastActivityAt: new Date(),
      });

      logger.info({ threadId }, "Session registered for consolidation");
    }
  }

  /**
   * Unregister a session
   */
  unregisterSession(threadId: string): void {
    if (this.sessions.delete(threadId)) {
      logger.info({ threadId }, "Session unregistered from consolidation");
    }
  }

  /**
   * Run a consolidation cycle for all registered sessions
   */
  async runConsolidationCycle(): Promise<void> {
    if (!this.isRunning) {
      logger.warn("Cannot run consolidation cycle: daemon is not running");
      return;
    }

    logger.info(
      { sessionsCount: this.sessions.size },
      "Starting consolidation cycle",
    );

    const results = {
      processed: 0,
      merged: 0,
      archived: 0,
      errors: 0,
    };

    for (const [threadId, session] of this.sessions.entries()) {
      try {
        logger.debug({ threadId }, "Consolidating thread");

        const result = await this.consolidationService.consolidate(threadId);

        results.processed += result.processed;
        results.merged += result.merged;
        results.archived += result.archived;
        results.errors += result.errors.length;

        // Update session activity
        session.lastActivityAt = new Date();

        if (result.errors.length > 0) {
          logger.warn(
            { threadId, errors: result.errors },
            "Consolidation completed with errors",
          );
        }
      } catch (error) {
        results.errors++;
        this.totalErrors++;
        logger.error({ error, threadId }, "Consolidation failed for thread");
      }
    }

    this.lastConsolidationAt = new Date();
    this.totalConsolidations++;

    logger.info(
      {
        processed: results.processed,
        merged: results.merged,
        archived: results.archived,
        errors: results.errors,
        totalConsolidations: this.totalConsolidations,
      },
      "Consolidation cycle completed",
    );

    // Schedule next consolidation
    this.scheduleNextConsolidation();
  }

  /**
   * Trigger an immediate consolidation for a specific thread
   */
  async triggerConsolidation(threadId: string): Promise<{
    success: boolean;
    result?: any;
    error?: string;
  }> {
    try {
      logger.info({ threadId }, "Triggering immediate consolidation");

      const result = await this.consolidationService.consolidate(threadId);

      // Update session activity if registered
      const session = this.sessions.get(threadId);
      if (session) {
        session.lastActivityAt = new Date();
      }

      return {
        success: true,
        result,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error, threadId }, "Immediate consolidation failed");

      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Get the current status of the daemon
   */
  getStatus(): DaemonStatus {
    const nextConsolidationAt = this.isRunning
      ? this.getNextConsolidationTime()
      : undefined;

    return {
      isRunning: this.isRunning,
      consolidationInterval: this.consolidationInterval,
      lastConsolidationAt: this.lastConsolidationAt || undefined,
      nextConsolidationAt,
      registeredSessions: this.sessions.size,
      totalConsolidations: this.totalConsolidations,
      totalErrors: this.totalErrors,
    };
  }

  /**
   * Get list of registered sessions
   */
  getRegisteredSessions(): SessionRegistration[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Clear all registered sessions
   */
  clearSessions(): void {
    const count = this.sessions.size;
    this.sessions.clear();
    logger.info({ count }, "Cleared all registered sessions");
  }

  /**
   * Set the consolidation interval
   */
  setConsolidationInterval(intervalMs: number): void {
    this.consolidationInterval = intervalMs;

    if (this.isRunning) {
      // Reschedule with new interval
      this.scheduleNextConsolidation();
      logger.info({ interval: intervalMs }, "Consolidation interval updated");
    }
  }

  /**
   * Schedule the next consolidation cycle
   */
  private scheduleNextConsolidation(): void {
    if (this.consolidationTimer) {
      clearTimeout(this.consolidationTimer);
    }

    this.consolidationTimer = setTimeout(async () => {
      await this.runConsolidationCycle();
    }, this.consolidationInterval);
  }

  /**
   * Calculate the next consolidation time
   */
  private getNextConsolidationTime(): Date {
    return new Date(Date.now() + this.consolidationInterval);
  }
}

/**
 * Get the MemoryDaemon singleton instance
 */
export function getMemoryDaemon(
  repository?: MemoryRepository,
  consolidationService?: ConsolidationService,
  embeddingService?: EmbeddingService,
  consolidationInterval?: number,
): MemoryDaemon {
  return MemoryDaemon.getInstance(
    repository,
    consolidationService,
    embeddingService,
    consolidationInterval,
  );
}
