// src/loop/scheduling.ts
import { LoopScheduler } from "./scheduler";
import { createPrBabysitterPattern } from "./patterns/pr-babysitter";
import { createCiSweeperPattern } from "./patterns/ci-sweeper";
import { createDailyTriagePattern } from "./patterns/daily-triage";
import { createLogger } from "../utils/logger";

const logger = createLogger("loop-scheduling");

function parseRepo(raw: string | undefined): { owner: string; name: string } | null {
  if (!raw) return null;
  const m = raw.match(/^([\w.-]+)\/([\w.-]+)$/);
  return m ? { owner: m[1]!, name: m[2]! } : null;
}

/**
 * Build a LoopScheduler with env-configured patterns. Does NOT start timers —
 * the caller starts/stops. Returns an empty scheduler when disabled.
 */
export function registerScheduledPatterns(): LoopScheduler {
  const scheduler = new LoopScheduler();
  if (process.env.LOOP_SCHEDULING_ENABLED !== "true") return scheduler;

  const githubToken = process.env.GITHUB_TOKEN;
  const repo = parseRepo(process.env.LOOP_REPO);

  if (
    process.env.LOOP_SCHEDULE_PR_BABYSITTER_MS &&
    githubToken &&
    repo
  ) {
    scheduler.register(
      createPrBabysitterPattern({
        repoConfig: repo,
        githubToken,
        repoDir: process.env.WORKSPACE_ROOT ?? "/workspace",
        intervalMs: Number(process.env.LOOP_SCHEDULE_PR_BABYSITTER_MS),
      }),
    );
  }
  if (process.env.LOOP_SCHEDULE_CI_SWEEPER_MS) {
    scheduler.register(
      createCiSweeperPattern({
        intervalMs: Number(process.env.LOOP_SCHEDULE_CI_SWEEPER_MS),
      }),
    );
  }
  if (process.env.LOOP_SCHEDULE_DAILY_TRIAGE_MS) {
    scheduler.register(
      createDailyTriagePattern({
        intervalMs: Number(process.env.LOOP_SCHEDULE_DAILY_TRIAGE_MS),
      }),
    );
  }

  logger.info(
    { patterns: scheduler.list().map((p) => p.name) },
    "[scheduling] registered patterns",
  );
  return scheduler;
}
