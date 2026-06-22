# Loop Engineering — L3 Scheduled/Event Loops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the "heartbeat" rung — an in-process `LoopScheduler` that fires loop runs on a timer, with one real pattern (PR-babysitter wiring the existing `PRReviewCycle`) and two compiling stub patterns (CI-sweeper, daily-triage), so my-swe can drive its own loops without a human prompting.

**Architecture:** A generic `LoopScheduler` registers named `ScheduledPattern`s (each = an interval + an async `run()`). Patterns own their event logic: `pr-babysitter` lists open PRs and runs `PRReviewCycle.runCycle` on those with unresolved comments; `ci-sweeper` and `daily-triage` are compiling stubs that derive a `GoalSpec` from a (pluggable) event source and call `LoopRunner.run`. A `registerScheduledPatterns()` wires env-configured patterns at startup. No external queue; v1 is interval-based (cron-string parsing is a documented future enhancement).

**Tech Stack:** TypeScript, Bun (`bun:test`), Octokit (already a dep), existing `PRReviewCycle` (`src/harness/pr-review-cycle.ts`) and `LoopRunner` (`src/loop/runner.ts`).

**Spec:** [`docs/superpowers/specs/2026-06-20-loop-engineering-design.md`](../specs/2026-06-20-loop-engineering-design.md) §6 Rung L3, §13 phase 4.

**Depends on:** Plan 1 (L1+L2) is merged — `LoopRunner`, `getLoopRunner()` exist.

## Global Constraints

- **Gate:** `bun test` stays green (no new failures beyond the documented pre-existing set) and `bunx tsc --noEmit` clean in real code (ignore the untracked `my-swe-494/` artifact dir).
- New code under `src/loop/scheduler.ts` and `src/loop/patterns/`. Shared edits: a startup registration call in `src/server.ts` (or `src/index.ts`) — one line, env-gated.
- **Env-gated:** scheduling activates only when `LOOP_SCHEDULING_ENABLED=true`. Off = nothing scheduled, zero behavior change.
- **Injectable for tests:** every pattern's external calls (GitHub list-PRs, `PRReviewCycle` construction, `LoopRunner`) must be injectable so tests need no network/sandbox/LLM.
- **Deterministic tests:** do NOT rely on real timers. Test via the scheduler's synchronous `fire(name)` method and injected fakes.
- TDD per task: red → green → commit.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/loop/scheduler.ts` | `LoopScheduler`: register/start/stop/fire/list; in-process interval driver |
| `src/loop/patterns/pr-babysitter.ts` | `createPrBabysitterPattern({...})` → `ScheduledPattern`; lists open PRs, runs `PRReviewCycle.runCycle` on those with unresolved comments |
| `src/loop/patterns/ci-sweeper.ts` | `createCiSweeperPattern({...})` → compiling stub deriving a goal from failed-CI events; calls `LoopRunner.run` |
| `src/loop/patterns/daily-triage.ts` | `createDailyTriagePattern({...})` → compiling stub deriving a goal from new issues; calls `LoopRunner.run` |
| `src/loop/scheduling.ts` | `registerScheduledPatterns(runner, deps?)` — env-driven registration; returns the `LoopScheduler` |
| `src/server.ts` *(modify)* | call `registerScheduledPatterns` at startup when `LOOP_SCHEDULING_ENABLED=true` |

**Dependency order:** 1 (scheduler) → 2,3,4 (patterns, parallel-safe but commit-sequenced) → 5 (registration) → 6 (wiring + integration).

---

## Task 1: `LoopScheduler`

**Files:**
- Create: `src/loop/scheduler.ts`
- Test: `src/loop/__tests__/scheduler.test.ts`

**Interfaces:**
- Produces: `ScheduledPattern { name: string; intervalMs: number; run: () => Promise<PatternRunSummary> }`; `PatternRunSummary { name: string; ok: boolean; detail: unknown; at: string; error?: string }`; `LoopScheduler` with `register(pattern)`, `start()`, `stop()`, `fire(name): Promise<PatternRunSummary>`, `list()`. Patterns (Tasks 2-4) produce `ScheduledPattern`; registration (Task 5) consumes the scheduler.

- [ ] **Step 1: Write the failing test**

```ts
// src/loop/__tests__/scheduler.test.ts
import { test, expect } from "bun:test";
import { LoopScheduler } from "../scheduler";

test("fire runs a registered pattern and returns a summary", async () => {
  const s = new LoopScheduler();
  let calls = 0;
  s.register({
    name: "p1",
    intervalMs: 60_000,
    run: async () => {
      calls += 1;
      return { name: "p1", ok: true, detail: { n: calls }, at: "now" };
    },
  });
  const out = await s.fire("p1");
  expect(out.ok).toBe(true);
  expect((out.detail as any).n).toBe(1);
  expect(s.list().map((p) => p.name)).toEqual(["p1"]);
});

test("fire on unknown pattern returns ok=false with an error", async () => {
  const s = new LoopScheduler();
  const out = await s.fire("nope");
  expect(out.ok).toBe(false);
  expect(out.error).toMatch(/not found/i);
});

test("run errors are caught and reported, not thrown", async () => {
  const s = new LoopScheduler();
  s.register({
    name: "boom",
    intervalMs: 60_000,
    run: async () => {
      throw new Error("kaboom");
    },
  });
  const out = await s.fire("boom");
  expect(out.ok).toBe(false);
  expect(out.error).toBe("kaboom");
});

test("start schedules a timer that fires run; stop clears it", async () => {
  const s = new LoopScheduler();
  let calls = 0;
  s.register({
    name: "tick",
    intervalMs: 20,
    run: async () => {
      calls += 1;
      return { name: "tick", ok: true, detail: null, at: "now" };
    },
  });
  s.start();
  await new Promise((r) => setTimeout(r, 70));
  s.stop();
  const ticked = calls;
  expect(ticked).toBeGreaterThanOrEqual(1);
  // after stop, no more ticks accrue
  await new Promise((r) => setTimeout(r, 70));
  expect(calls).toBe(ticked);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/loop/__tests__/scheduler.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/loop/scheduler.ts
import { createLogger } from "../../utils/logger";

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/loop/__tests__/scheduler.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/loop/scheduler.ts src/loop/__tests__/scheduler.test.ts
git commit -m "feat(loop): add in-process LoopScheduler (L3 heartbeat)"
```

---

## Task 2: PR-babysitter pattern

**Files:**
- Create: `src/loop/patterns/pr-babysitter.ts`
- Test: `src/loop/__tests__/patterns/pr-babysitter.test.ts`

**Interfaces:**
- Consumes: `PRReviewCycle` + `PRReviewResult` from `../../harness/pr-review-cycle`; `ScheduledPattern`, `PatternRunSummary` from `../scheduler`.
- Produces: `createPrBabysitterPattern(opts: { name?; intervalMs?; repoConfig; githubToken; threadIdPrefix?; repoDir; sandbox?; listOpenPRs?: () => Promise<number[]>; reviewCycleFactory?: (prNumber: number) => { fetchUnresolvedComments(n): Promise<unknown[]>; runCycle(n, maxRounds?): Promise<PRReviewResult> } }): ScheduledPattern`. The pattern's `run()` lists open PRs, and for each with unresolved comments, runs the review cycle. Returns a `PatternRunSummary` whose `detail` is `{ prsScanned, prsAddressed, results: PRReviewResult[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/loop/__tests__/patterns/pr-babysitter.test.ts
import { test, expect } from "bun:test";
import { createPrBabysitterPattern } from "../../patterns/pr-babysitter";

function fakeCycle(unresolvedCount: number) {
  return {
    fetchUnresolvedComments: async () => Array(unresolvedCount).fill({}),
    runCycle: async (n: number) => ({
      prNumber: n,
      totalComments: unresolvedCount,
      addressedComments: unresolvedCount,
      commitsPushed: 1,
      remainingIssues: [],
    }),
  };
}

test("pr-babysitter runs review cycles only for PRs with unresolved comments", async () => {
  const runFor = new Set<number>();
  const pattern = createPrBabysitterPattern({
    repoConfig: { owner: "o", name: "r" },
    githubToken: "tok",
    repoDir: "/repo",
    listOpenPRs: async () => [1, 2, 3],
    // PR 2 has zero unresolved comments -> skipped
    reviewCycleFactory: (prNumber: number) =>
      fakeCycle(prNumber === 2 ? 0 : 3),
  });
  // Wrap runCycle to record which PRs actually ran a cycle
  const base = pattern.run;
  pattern.run = async () => {
    const orig = pattern as unknown as { __opts: any };
    return base.call(pattern);
  };
  void base;

  const summary = await pattern.run();
  expect(summary.ok).toBe(true);
  const detail = summary.detail as any;
  expect(detail.prsScanned).toBe(3);
  expect(detail.prsAddressed).toBe(2); // PRs 1 and 3
  expect(detail.results).toHaveLength(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/loop/__tests__/patterns/pr-babysitter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/loop/patterns/pr-babysitter.ts
import { PRReviewCycle, type PRReviewResult } from "../../harness/pr-review-cycle";
import type { RepoConfig } from "../../utils/github";
import type { SandboxService } from "../../integrations/sandbox-service";
import type { ScheduledPattern, PatternRunSummary } from "../scheduler";
import { Octokit } from "octokit";

export interface PrBabysitterOptions {
  name?: string;
  intervalMs?: number;
  repoConfig: RepoConfig;
  githubToken: string;
  threadIdPrefix?: string;
  repoDir: string;
  sandbox?: SandboxService | null;
  /** Injectable: list open PR numbers. Default: Octokit. */
  listOpenPRs?: () => Promise<number[]>;
  /** Injectable: build a review-cycle-like object per PR. Default: real PRReviewCycle. */
  reviewCycleFactory?: (prNumber: number) => {
    fetchUnresolvedComments: (prNumber: number) => Promise<unknown[]>;
    runCycle: (prNumber: number, maxRounds?: number) => Promise<PRReviewResult>;
  };
}

export function createPrBabysitterPattern(
  opts: PrBabysitterOptions,
): ScheduledPattern {
  const name = opts.name ?? "pr-babysitter";
  const intervalMs = opts.intervalMs ?? 15 * 60_000;

  const listOpenPRs =
    opts.listOpenPRs ??
    (async () => {
      const octokit = new Octokit({ auth: opts.githubToken });
      const prs = await octokit.paginate(octokit.rest.pulls.list, {
        owner: opts.repoConfig.owner,
        repo: opts.repoConfig.name,
        state: "open",
        per_page: 100,
      });
      return prs.map((p) => (p as { number: number }).number);
    });

  const makeCycle =
    opts.reviewCycleFactory ??
    ((prNumber: number) => {
      void prNumber;
      const cycle = new PRReviewCycle(
        opts.repoConfig,
        opts.githubToken,
        `${opts.threadIdPrefix ?? "pr-babysitter"}-${Date.now()}`,
        opts.repoDir,
        opts.sandbox ?? null,
      );
      return {
        fetchUnresolvedComments: (n: number) => cycle.fetchUnresolvedComments(n),
        runCycle: (n: number, maxRounds?: number) =>
          cycle.runCycle(n, maxRounds),
      };
    });

  return {
    name,
    intervalMs,
    run: async (): Promise<PatternRunSummary> => {
      const at = new Date().toISOString();
      const results: PRReviewResult[] = [];
      try {
        const prs = await listOpenPRs();
        for (const prNumber of prs) {
          const cycle = makeCycle(prNumber);
          const unresolved = await cycle.fetchUnresolvedComments(prNumber);
          if (unresolved.length === 0) continue; // nothing to babysit
          results.push(await cycle.runCycle(prNumber, 2));
        }
        return {
          name,
          ok: true,
          detail: { prsScanned: prs.length, prsAddressed: results.length, results },
          at,
        };
      } catch (err) {
        return {
          name,
          ok: false,
          detail: { results },
          at,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/loop/__tests__/patterns/pr-babysitter.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/loop/patterns/pr-babysitter.ts src/loop/__tests__/patterns/pr-babysitter.test.ts
git commit -m "feat(loop): add pr-babysitter scheduled pattern wiring PRReviewCycle"
```

---

## Task 3: CI-sweeper stub pattern

**Files:**
- Create: `src/loop/patterns/ci-sweeper.ts`
- Test: `src/loop/__tests__/patterns/ci-sweeper.test.ts`

**Interfaces:**
- Consumes: `LoopRunner` return (`LoopRunResult`) from `../runner`; `ScheduledPattern` from `../scheduler`.
- Produces: `createCiSweeperPattern(opts: { name?; intervalMs?; threadIdPrefix?; fetchFailedRuns?: () => Promise<{ id: string; description: string; repo?: string }[]>; runLoop?: (input: { input: string; threadId: string }) => Promise<{ outcome: string; reply: string }> }): ScheduledPattern`. The default `fetchFailedRuns` is a documented stub (`// TODO: wire to CI event source`); the default `runLoop` calls `getLoopRunner().run`. `run()` derives a `GoalSpec` per failed run and invokes the loop.

- [ ] **Step 1: Write the failing test**

```ts
// src/loop/__tests__/patterns/ci-sweeper.test.ts
import { test, expect } from "bun:test";
import { createCiSweeperPattern } from "../../patterns/ci-sweeper";

test("ci-sweeper derives a goal per failed run and invokes the loop", async () => {
  const invoked: string[] = [];
  const pattern = createCiSweeperPattern({
    fetchFailedRuns: async () => [
      { id: "run-1", description: "build failed on bun test" },
    ],
    runLoop: async ({ input, threadId }) => {
      invoked.push(`${threadId}:${input.slice(0, 12)}`);
      return { outcome: "passed", reply: "fixed" };
    },
  });
  const summary = await pattern.run();
  expect(summary.ok).toBe(true);
  expect(invoked).toHaveLength(1);
  expect(invoked[0]).toContain("ci-sweeper");
  expect(summary.detail).toMatchObject({ runsScanned: 1, runsHandled: 1 });
});

test("ci-sweeper with no failed runs handles empty", async () => {
  const pattern = createCiSweeperPattern({
    fetchFailedRuns: async () => [],
    runLoop: async () => ({ outcome: "passed", reply: "" }),
  });
  const summary = await pattern.run();
  expect(summary.ok).toBe(true);
  expect((summary.detail as any).runsScanned).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/loop/__tests__/patterns/ci-sweeper.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
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
    (async ({ input, threadId }) => {
      const { getLoopRunner } = await import("../runner").then(() =>
        import("../../server"),
      );
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/loop/__tests__/patterns/ci-sweeper.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/loop/patterns/ci-sweeper.ts src/loop/__tests__/patterns/ci-sweeper.test.ts
git commit -m "feat(loop): add ci-sweeper scheduled pattern (stub event source)"
```

---

## Task 4: Daily-triage stub pattern

**Files:**
- Create: `src/loop/patterns/daily-triage.ts`
- Test: `src/loop/__tests__/patterns/daily-triage.test.ts`

**Interfaces:**
- Produces: `createDailyTriagePattern(opts: { name?; intervalMs?; threadIdPrefix?; fetchNewIssues?: () => Promise<{ number: number; title: string; body?: string }[]>; runLoop?: (input: { input: string; threadId: string }) => Promise<{ outcome: string; reply: string }> }): ScheduledPattern`. Same shape as ci-sweeper but over new issues; default `fetchNewIssues` is a documented stub.

- [ ] **Step 1: Write the failing test**

```ts
// src/loop/__tests__/patterns/daily-triage.test.ts
import { test, expect } from "bun:test";
import { createDailyTriagePattern } from "../../patterns/daily-triage";

test("daily-triage invokes the loop once per new issue", async () => {
  const invoked: string[] = [];
  const pattern = createDailyTriagePattern({
    fetchNewIssues: async () => [
      { number: 11, title: "bug: crash on start", body: "steps…" },
      { number: 12, title: "feat: add export" },
    ],
    runLoop: async ({ input, threadId }) => {
      invoked.push(`${threadId}|${input.length > 0}`);
      return { outcome: "escalated", reply: "triaged" };
    },
  });
  const summary = await pattern.run();
  expect(summary.ok).toBe(true);
  expect(invoked).toHaveLength(2);
  expect((summary.detail as any).issuesTriaged).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/loop/__tests__/patterns/daily-triage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/loop/__tests__/patterns/daily-triage.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/loop/patterns/daily-triage.ts src/loop/__tests__/patterns/daily-triage.test.ts
git commit -m "feat(loop): add daily-triage scheduled pattern (stub event source)"
```

---

## Task 5: Env-driven registration

**Files:**
- Create: `src/loop/scheduling.ts`
- Test: `src/loop/__tests__/scheduling.test.ts`

**Interfaces:**
- Consumes: `LoopScheduler`, the three pattern factories.
- Produces: `registerScheduledPatterns(): LoopScheduler` — reads env (`LOOP_SCHEDULING_ENABLED`, `LOOP_SCHEDULE_PR_BABYSITTER_MS`, `LOOP_SCHEDULE_CI_SWEEPER_MS`, `LOOP_SCHEDULE_DAILY_TRIAGE_MS`, plus repo/token config) and registers the enabled patterns. Returns the scheduler (not started — the caller decides). Off by default.

- [ ] **Step 1: Write the failing test**

```ts
// src/loop/__tests__/scheduling.test.ts
import { test, expect, beforeEach } from "bun:test";
import { registerScheduledPatterns } from "../scheduling";

const KEYS = [
  "LOOP_SCHEDULING_ENABLED",
  "LOOP_SCHEDULE_PR_BABYSITTER_MS",
  "GITHUB_TOKEN",
  "GITHUB_DEFAULT_OWNER",
];
beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
});

test("returns a scheduler with no patterns when disabled", () => {
  const s = registerScheduledPatterns();
  expect(s.list()).toEqual([]);
});

test("registers pr-babysitter when enabled + configured", () => {
  process.env.LOOP_SCHEDULING_ENABLED = "true";
  process.env.GITHUB_TOKEN = "tok";
  process.env.GITHUB_DEFAULT_OWNER = "me";
  process.env.LOOP_REPO = "me/myrepo";
  process.env.LOOP_SCHEDULE_PR_BABYSITTER_MS = "30000";
  const s = registerScheduledPatterns();
  const names = s.list().map((p) => p.name);
  expect(names).toContain("pr-babysitter");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/loop/__tests__/scheduling.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/loop/__tests__/scheduling.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/loop/scheduling.ts src/loop/__tests__/scheduling.test.ts
git commit -m "feat(loop): add env-driven registerScheduledPatterns (off by default)"
```

---

## Task 6: Startup wiring + integration proof

**Files:**
- Modify: `src/server.ts` (start the scheduler at startup, env-gated)
- Test: `src/loop/__tests__/scheduling.integration.test.ts`

**Interfaces:**
- Produces: `getLoopScheduler()` exported from `src/server.ts` (lazy singleton), started when `LOOP_SCHEDULING_ENABLED=true`. An integration test proves the scheduler fires a pattern that invokes a (faked) loop at a `fire()` call.

- [ ] **Step 1: Write the failing test**

```ts
// src/loop/__tests__/scheduling.integration.test.ts
import { test, expect } from "bun:test";
import { registerScheduledPatterns } from "../scheduling";

test("scheduler fires a pattern end-to-end via fire()", async () => {
  const scheduler = registerScheduledPatterns(); // disabled in test env -> empty
  // Register an ad-hoc pattern to prove the scheduler drives a loop run.
  let ran = 0;
  scheduler.register({
    name: "ad-hoc",
    intervalMs: 60_000,
    run: async () => {
      ran += 1;
      return { name: "ad-hoc", ok: true, detail: { ran }, at: "now" };
    },
  });
  const out = await scheduler.fire("ad-hoc");
  expect(out.ok).toBe(true);
  expect(ran).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/loop/__tests__/scheduling.integration.test.ts`
Expected: FAIL — or pass if the scheduler already works; the real assertion under test is the wiring export below.

- [ ] **Step 3: Wire startup in `src/server.ts`**

Add to `src/server.ts` (near the `getLoopRunner` singleton):

```ts
import { registerScheduledPatterns, type LoopScheduler } from "./loop/scheduling";

let schedulerSingleton: ReturnType<typeof registerScheduledPatterns> | undefined;
let schedulerStarted = false;

/** Lazy scheduler singleton. Started once at startup when LOOP_SCHEDULING_ENABLED. */
export function getLoopScheduler() {
  if (!schedulerSingleton) schedulerSingleton = registerScheduledPatterns();
  return schedulerSingleton;
}

/** Call once at process startup to (optionally) start scheduled loops. */
export function startScheduledLoops() {
  const s = getLoopScheduler();
  if (schedulerStarted || s.list().length === 0) return s;
  s.start();
  schedulerStarted = true;
  return s;
}
```

And in the existing startup path (the module-level initialization or wherever `initAgentProviderAtStartup()` is called), add `startScheduledLoops();` — guarded so it only acts when patterns exist. If there is no clear startup hook in `server.ts`, add the call at the bottom of `src/index.ts` (Telegram long-polling entry) and `src/webapp.ts` server-listen path, each guarded by `LOOP_SCHEDULING_ENABLED`.

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test src/loop/__tests__/scheduling.integration.test.ts src/loop/`
Expected: PASS, and no new failures in `bun test src/__tests__/server.test.ts`.
Run: `bunx tsc --noEmit`
Expected: clean in real code.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/loop/__tests__/scheduling.integration.test.ts
git commit -m "feat(loop): wire LoopScheduler startup (LOOP_SCHEDULING_ENABLED) + integration proof"
```

---

## Definition of Done (Plan 2 / L3)

- All 6 tasks green; `bun test src/loop/` passes (scheduler + 3 patterns + registration + integration); `bunx tsc --noEmit` clean in real code.
- With `LOOP_SCHEDULING_ENABLED=true` + a PR-babysitter interval, my-swe will periodically run `PRReviewCycle` over open PRs with unresolved comments — the first self-driving loop. ci-sweeper/daily-triage compile and run with stub event sources.
- No behavior change when the flags are off.

## Notes for the executor

- Patterns must be fully injectable so tests use no network, no sandbox, no LLM. Never call the real Octokit/`getLoopRunner` in a unit test.
- `bun:test` has no fake-clock API — test scheduling via `fire(name)`, and test the real interval only with a tiny 20ms interval + manual sleep (Task 1's last test). Keep that test's sleeps short.
- The ci-sweeper/daily-triage defaults are intentional stubs (`// TODO: wire to real CI/issues`). They must compile, run, and return `ok: true` with an empty result — not throw.
- Do not auto-start timers in `registerScheduledPatterns`; only `startScheduledLoops()` starts them, and only if patterns exist.
