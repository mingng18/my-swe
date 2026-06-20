// src/loop/patterns/daily-triage.ts
import type { ScheduledPattern, PatternRunSummary } from "../scheduler";

export interface NewIssue {
  number: number;
  title: string;
  body?: string;
}

export interface DailyTriageOptions {
  name?: string;
  intervalMs?: number;
  threadIdPrefix?: string;
  /** Injectable event source. Default: stub (TODO: wire to GitHub issues). */
  fetchNewIssues?: () => Promise<NewIssue[]>;
  runLoop?: (input: { input: string; threadId: string }) => Promise<{
    outcome: string;
    reply: string;
  }>;
}

export function createDailyTriagePattern(opts: DailyTriageOptions): ScheduledPattern {
  const name = opts.name ?? "daily-triage";
  const intervalMs = opts.intervalMs ?? 24 * 60 * 60_000;
  const prefix = opts.threadIdPrefix ?? name;

  const fetchNewIssues =
    opts.fetchNewIssues ??
    (async () => {
      // TODO: wire to GitHub issues (created-since query).
      return [] as NewIssue[];
    });

  const runLoop =
    opts.runLoop ??
    (async ({ input, threadId }) => {
      const { getLoopRunner } = await import("../../server");
      const res = await getLoopRunner().run({ input, threadId });
      return { outcome: res.outcome, reply: res.reply };
    });

  return {
    name,
    intervalMs,
    run: async (): Promise<PatternRunSummary> => {
      const at = new Date().toISOString();
      let issuesTriaged = 0;
      try {
        const issues = await fetchNewIssues();
        for (const issue of issues) {
          const input = `Triage issue #${issue.number}: ${issue.title}${
            issue.body ? `\n\n${issue.body}` : ""
          }`;
          await runLoop({ input, threadId: `${prefix}-issue-${issue.number}` });
          issuesTriaged += 1;
        }
        return { name, ok: true, detail: { issuesTriaged }, at };
      } catch (err) {
        return {
          name,
          ok: false,
          detail: { issuesTriaged },
          at,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
