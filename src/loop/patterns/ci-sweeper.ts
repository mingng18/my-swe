// src/loop/patterns/ci-sweeper.ts
import type { ScheduledPattern, PatternRunSummary } from "../scheduler";

export interface FailedCIRun {
  id: string;
  description: string;
  repo?: string;
}

export interface CiSweeperOptions {
  name?: string;
  intervalMs?: number;
  threadIdPrefix?: string;
  maxIterations?: number;
  /** Injectable event source. Default: stub (TODO: wire to real CI). */
  fetchFailedRuns?: () => Promise<FailedCIRun[]>;
  /** Injectable loop invocation. Default: getLoopRunner().run. */
  runLoop?: (input: { input: string; threadId: string }) => Promise<{
    outcome: string;
    reply: string;
  }>;
}

export function createCiSweeperPattern(opts: CiSweeperOptions): ScheduledPattern {
  const name = opts.name ?? "ci-sweeper";
  const intervalMs = opts.intervalMs ?? 10 * 60_000;
  const prefix = opts.threadIdPrefix ?? name;

  const fetchFailedRuns =
    opts.fetchFailedRuns ??
    (async () => {
      // TODO: wire to a real CI event source (GitHub Actions runs / webhooks).
      return [] as FailedCIRun[];
    });

  const runLoop =
    opts.runLoop ??
    (async ({ input, threadId }: { input: string; threadId: string }) => {
      const { getLoopRunner } = await import("../../server");
      const res = await getLoopRunner().run({ input, threadId });
      return { outcome: res.outcome, reply: res.reply };
    });

  return {
    name,
    intervalMs,
    run: async (): Promise<PatternRunSummary> => {
      const at = new Date().toISOString();
      let runsHandled = 0;
      try {
        const runs = await fetchFailedRuns();
        for (const r of runs) {
          const input = `CI run "${r.id}" failed: ${r.description}. Diagnose the failure and fix it.`;
          await runLoop({ input, threadId: `${prefix}-${r.id}` });
          runsHandled += 1;
        }
        return {
          name,
          ok: true,
          detail: { runsScanned: runs.length, runsHandled },
          at,
        };
      } catch (err) {
        return {
          name,
          ok: false,
          detail: { runsScanned: 0, runsHandled },
          at,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
