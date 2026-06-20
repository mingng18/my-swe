// src/loop/scheduler.ts
import { createLogger } from "../utils/logger";

const logger = createLogger("loop-scheduler");

export interface PatternRunSummary {
  name: string;
  ok: boolean;
  detail: unknown;
  at: string;
  error?: string;
}

export interface ScheduledPattern {
  name: string;
  intervalMs: number;
  run: () => Promise<PatternRunSummary | void>;
}

export class LoopScheduler {
  private patterns = new Map<string, ScheduledPattern>();
  private timers = new Map<string, NodeJS.Timeout>();

  register(pattern: ScheduledPattern): void {
    if (this.patterns.has(pattern.name)) {
      throw new Error(`Pattern "${pattern.name}" already registered`);
    }
    this.patterns.set(pattern.name, pattern);
  }

  list(): ScheduledPattern[] {
    return Array.from(this.patterns.values());
  }

  /** Manually fire a pattern by name (deterministic; used by tests + manual triggers). */
  async fire(name: string): Promise<PatternRunSummary> {
    const pattern = this.patterns.get(name);
    const at = new Date().toISOString();
    if (!pattern) {
      return { name, ok: false, detail: null, at, error: `Pattern "${name}" not found` };
    }
    try {
      const res = await pattern.run();
      return res && typeof res.ok === "boolean"
        ? { ...res, at }
        : { name, ok: true, detail: res ?? null, at };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error({ name, error }, "[scheduler] pattern run failed");
      return { name, ok: false, detail: null, at, error };
    }
  }

  /** Start interval timers for all registered patterns. */
  start(): void {
    for (const pattern of this.patterns.values()) {
      if (this.timers.has(pattern.name)) continue;
      const timer = setInterval(() => {
        void this.fire(pattern.name);
      }, pattern.intervalMs);
      this.timers.set(pattern.name, timer);
      logger.info({ name: pattern.name, intervalMs: pattern.intervalMs }, "[scheduler] started");
    }
  }

  /** Clear all timers. */
  stop(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    logger.info("[scheduler] stopped");
  }
}
