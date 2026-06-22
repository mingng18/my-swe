# Loop Engineering — L4 Self-Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The hill-climbing rung — an analysis job over persisted traces that clusters failure patterns, proposes harness-config deltas, and **eval-gates** each delta (accept only if it improves eval pass-rate, never if it regresses), recording decisions for human review. This is the loop that "reaches inside and updates the agent loop" — off by default, HITL-gated, no auto-mutation of the harness in v1.

**Architecture:** `analyzer` reads traces (`TraceStore.queryAll`, added here) and clusters failures into an `AnalysisReport`. `config-rewriter` turns clusters into deterministic `ConfigDelta` proposals (prompt addenda / grader tightenings) via templates. `apply` evaluates each delta against the eval suite (injectable `evalRunner`) — accept iff pass-rate improves, reject iff it regresses — and records decisions to the trace store + creates a HITL request for accepted deltas. `runSelfImprovementCycle()` orchestrates the three; triggerable manually/HTTP, gated by `LOOP_SELF_IMPROVE_ENABLED`. **v1 does not mutate real harness config** — it proposes + eval-gates + records; applying is HITL-gated and deferred (responsible default).

**Tech Stack:** TypeScript, Bun (`bun:test`), existing `TraceStore` (`src/loop/trace-store.ts`), `EvalHarness` (`src/eval/harness.ts`), `HITLStore` (`src/loop/hitl.ts`).

**Spec:** [`docs/superpowers/specs/2026-06-20-loop-engineering-design.md`](../specs/2026-06-20-loop-engineering-design.md) §6 Rung L4, §10 (`LOOP_SELF_IMPROVE_ENABLED`).

**Depends on:** Plans 1 (L1+L2: `TraceStore`, `HITLStore`, `getLoopRunner`) — merged.

## Global Constraints

- **Gate:** `bun test` stays green; `bunx tsc --noEmit` clean in real code (ignore untracked `my-swe-494/`).
- New code under `src/loop/self-improve/`. The only edit to existing code is an **additive** `queryAll()` on `TraceStore` (Task 1) and an HTTP trigger route (Task 4).
- **No auto-mutation:** v1 never edits harness config files or prompts directly. It proposes, eval-gates, records, and HITL-requests. Off by default (`LOOP_SELF_IMPROVE_ENABLED`).
- Fully injectable (`evalRunner`, traces) so tests need no LLM, no network, no real eval run.
- Deterministic rewriter (templates keyed on failure pattern) — no LLM in the rewriter for v1.
- TDD per task.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/loop/self-improve/analyzer.ts` | `analyze(traces): AnalysisReport` — cluster failures |
| `src/loop/trace-store.ts` *(modify)* | Additive `queryAll(): TraceRecord[]` |
| `src/loop/self-improve/config-rewriter.ts` | `proposeDeltas(report): ConfigDelta[]` — deterministic templates |
| `src/loop/self-improve/apply.ts` | `evaluateDelta`, `recordDecision` — eval-gated accept/reject |
| `src/loop/self-improve/orchestrator.ts` | `runSelfImprovementCycle(deps)` + trigger; HITL-gated, off by default |
| `src/webapp.ts` *(modify)* | `POST /loop/self-improve` trigger (env-gated) |

**Order:** 1 (analyzer + queryAll) → 2 (rewriter) → 3 (apply) → 4 (orchestrator + route).

---

## Task 1: Analyzer + `TraceStore.queryAll`

**Files:**
- Create: `src/loop/self-improve/analyzer.ts`
- Modify: `src/loop/trace-store.ts` (additive `queryAll`)
- Test: `src/loop/self-improve/__tests__/analyzer.test.ts`

**Interfaces:**
- Consumes: `TraceRecord`, `IterationRecord` from `../trace-store`.
- Produces: `FailureCluster { pattern: string; step: string; count: number; sampleTraceIds: string[] }`; `AnalysisReport { totalRuns: number; passed: number; escalated: number; passRate: number; failureClusters: FailureCluster[] }`; `analyze(traces: TraceRecord[]): AnalysisReport`. Failure `pattern` is a normalized bucket: `"import_error"` if output matches `/cannot find module|import|resolve/i`; `"type_error"` if `/error ts|type/i`; `"test_failure"` otherwise.

- [ ] **Step 1: Write the failing test**

```ts
// src/loop/self-improve/__tests__/analyzer.test.ts
import { test, expect } from "bun:test";
import { analyze } from "../analyzer";
import type { TraceRecord } from "../../trace-store";
import { deriveGoal } from "../../goal";

function trace(outcome: TraceRecord["outcome"], fails: { step: string; output: string }[], traceId: string): TraceRecord {
  return {
    traceId, threadId: "t", goal: deriveGoal("x"), startedAt: "now",
    iterations: [{ index: 0, agentOutput: "", verification: fails.map((f) => ({ step: f.step, passed: false, output: f.output })), decision: outcome === "passed" ? "pass" : "escalate" }],
    outcome,
  };
}

test("analyzes pass rate + clusters import/type/test failures", () => {
  const traces: TraceRecord[] = [
    trace("passed", [], "a"),
    trace("escalated", [{ step: "run_tests", output: "Error: Cannot find module './x'" }], "b"),
    trace("escalated", [{ step: "run_tests", output: "error TS2304: Cannot find name 'foo'" }], "c"),
    trace("escalated", [{ step: "run_tests", output: "AssertionError: expected 2 got 1" }], "d"),
    trace("escalated", [{ step: "run_tests", output: "Cannot find module './y'" }], "e"),
  ];
  const r = analyze(traces);
  expect(r.totalRuns).toBe(5);
  expect(r.passed).toBe(1);
  expect(r.passRate).toBeCloseTo(0.2);
  const byPattern = Object.fromEntries(r.failureClusters.map((c) => [c.pattern, c]));
  expect(byPattern.import_error.count).toBe(2);
  expect(byPattern.type_error.count).toBe(1);
  expect(byPattern.test_failure.count).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/loop/self-improve/__tests__/analyzer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3a: Add `queryAll` to `TraceStore`**

In `src/loop/trace-store.ts`, add to the `TraceStore` interface and the `createTraceStore` return object:

```ts
// in the interface:
queryAll(): TraceRecord[];
// in the returned object (db is already in scope):
queryAll() {
  const rows = db.query(`SELECT record FROM traces ORDER BY startedAt ASC`).all() as { record: string }[];
  return rows.map((r) => JSON.parse(r.record) as TraceRecord);
}
```

- [ ] **Step 3b: Write the analyzer**

```ts
// src/loop/self-improve/analyzer.ts
import type { TraceRecord } from "../trace-store";

export interface FailureCluster {
  pattern: "import_error" | "type_error" | "test_failure";
  step: string;
  count: number;
  sampleTraceIds: string[];
}

export interface AnalysisReport {
  totalRuns: number;
  passed: number;
  escalated: number;
  passRate: number;
  failureClusters: FailureCluster[];
}

function classify(output: string): FailureCluster["pattern"] {
  if (/cannot find module|import|resolve/i.test(output)) return "import_error";
  if (/error ts|type error|typecheck/i.test(output)) return "type_error";
  return "test_failure";
}

export function analyze(traces: TraceRecord[]): AnalysisReport {
  const totalRuns = traces.length;
  const passed = traces.filter((t) => t.outcome === "passed").length;
  const escalated = traces.filter((t) => t.outcome === "escalated").length;

  const clusters = new Map<string, FailureCluster>();
  for (const t of traces) {
    for (const iter of t.iterations) {
      for (const v of iter.verification) {
        if (v.passed) continue;
        const pattern = classify(v.output);
        const key = `${pattern}:${v.step}`;
        const existing = clusters.get(key);
        if (existing) {
          existing.count += 1;
          if (existing.sampleTraceIds.length < 3) existing.sampleTraceIds.push(t.traceId);
        } else {
          clusters.set(key, { pattern, step: v.step, count: 1, sampleTraceIds: [t.traceId] });
        }
      }
    }
  }

  return {
    totalRuns,
    passed,
    escalated,
    passRate: totalRuns === 0 ? 0 : passed / totalRuns,
    failureClusters: Array.from(clusters.values()).sort((a, b) => b.count - a.count),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/loop/self-improve/__tests__/analyzer.test.ts`
Expected: PASS (1 test). Also re-run `bun test src/loop/__tests__/trace-store.test.ts` — still green (additive method).

- [ ] **Step 5: Commit**

```bash
git add src/loop/self-improve/analyzer.ts src/loop/self-improve/__tests__/analyzer.test.ts src/loop/trace-store.ts
git commit -m "feat(loop): add trace analyzer + TraceStore.queryAll (L4)"
```

---

## Task 2: Config rewriter (deterministic templates)

**Files:**
- Create: `src/loop/self-improve/config-rewriter.ts`
- Test: `src/loop/self-improve/__tests__/config-rewriter.test.ts`

**Interfaces:**
- Consumes: `AnalysisReport`, `FailureCluster` from `./analyzer`.
- Produces: `ConfigDelta { id: string; type: "prompt_addendum" | "grader_tighten"; target: string; rationale: string; patch: string; sourcePattern: string }`; `proposeDeltas(report: AnalysisReport): ConfigDelta[]`. One delta per high-signal cluster (count >= 1), via templates.

- [ ] **Step 1: Write the failing test**

```ts
// src/loop/self-improve/__tests__/config-rewriter.test.ts
import { test, expect } from "bun:test";
import { proposeDeltas } from "../config-rewriter";
import type { AnalysisReport } from "../analyzer";

const report: AnalysisReport = {
  totalRuns: 5, passed: 1, escalated: 4, passRate: 0.2,
  failureClusters: [
    { pattern: "import_error", step: "run_tests", count: 3, sampleTraceIds: ["a", "b"] },
    { pattern: "type_error", step: "run_tests", count: 1, sampleTraceIds: ["c"] },
  ],
};

test("proposes a prompt_addendum for import errors and type errors", () => {
  const deltas = proposeDeltas(report);
  expect(deltas.length).toBe(2);
  const importDelta = deltas.find((d) => d.sourcePattern === "import_error");
  expect(importDelta?.type).toBe("prompt_addendum");
  expect(importDelta?.patch.toLowerCase()).toMatch(/import/);
  const typeDelta = deltas.find((d) => d.sourcePattern === "type_error");
  expect(typeDelta?.rationale).toMatch(/type/i);
});

test("empty report -> no deltas", () => {
  expect(proposeDeltas({ totalRuns: 0, passed: 0, escalated: 0, passRate: 0, failureClusters: [] })).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/loop/self-improve/__tests__/config-rewriter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/loop/self-improve/config-rewriter.ts
import type { AnalysisReport, FailureCluster } from "./analyzer";

export interface ConfigDelta {
  id: string;
  type: "prompt_addendum" | "grader_tighten";
  target: string;
  rationale: string;
  patch: string;
  sourcePattern: string;
}

const TEMPLATES: Record<FailureCluster["pattern"], (c: FailureCluster) => Omit<ConfigDelta, "id" | "sourcePattern">> = {
  import_error: (c) => ({
    type: "prompt_addendum",
    target: "agent-system-prompt",
    rationale: `Import failures occurred ${c.count}x on ${c.step}; the agent is claiming done before imports resolve.`,
    patch:
      "Before declaring a task complete, ensure all new/changed modules import cleanly — run the typecheck and resolve every 'cannot find module' / unresolved import.",
  }),
  type_error: (c) => ({
    type: "prompt_addendum",
    target: "agent-system-prompt",
    rationale: `TypeScript errors occurred ${c.count}x on ${c.step}.`,
    patch: "Resolve all TypeScript errors. Do not silence errors with `any` casts or @ts-ignore.",
  }),
  test_failure: (c) => ({
    type: "grader_tighten",
    target: "verify-gate",
    rationale: `Generic test failures occurred ${c.count}x on ${c.step}.`,
    patch: "Require the full test suite (not only touched files) to pass before the verify gate accepts.",
  }),
};

export function proposeDeltas(report: AnalysisReport): ConfigDelta[] {
  return report.failureClusters.map((c, i) => ({
    id: `delta-${i + 1}-${c.pattern}`,
    sourcePattern: c.pattern,
    ...TEMPLATES[c.pattern](c),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/loop/self-improve/__tests__/config-rewriter.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/loop/self-improve/config-rewriter.ts src/loop/self-improve/__tests__/config-rewriter.test.ts
git commit -m "feat(loop): add deterministic config-rewriter (L4)"
```

---

## Task 3: Eval-gated apply

**Files:**
- Create: `src/loop/self-improve/apply.ts`
- Test: `src/loop/self-improve/__tests__/apply.test.ts`

**Interfaces:**
- Consumes: `ConfigDelta` from `./config-rewriter`.
- Produces: `EvalRunner = (delta: ConfigDelta) => Promise<number>` (pass-rate 0..1); `EvalDecision { deltaId; decision: "accept" | "reject"; before: number; after: number; reason: string }`; `evaluateDelta(delta, { evalRunner, baselinePassRate }): Promise<EvalDecision>` — accept iff `after > baseline` (strictly improves), reject otherwise; `recordDecision(traceStore, decision, delta)` — append a self-improve event to the trace store as a synthetic trace (so decisions are observable in L4's own input).

- [ ] **Step 1: Write the failing test**

```ts
// src/loop/self-improve/__tests__/apply.test.ts
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { evaluateDelta } from "../apply";
import { createTraceStore } from "../../trace-store";
import type { ConfigDelta } from "../config-rewriter";

const delta: ConfigDelta = {
  id: "d1", type: "prompt_addendum", target: "p",
  rationale: "r", patch: "p", sourcePattern: "import_error",
};

test("accepts a delta that strictly improves pass rate", async () => {
  const decision = await evaluateDelta(delta, {
    evalRunner: async () => 0.8,
    baselinePassRate: 0.5,
  });
  expect(decision.decision).toBe("accept");
  expect(decision.after).toBe(0.8);
});

test("rejects a delta that does not improve (regression or flat)", async () => {
  const flat = await evaluateDelta(delta, { evalRunner: async () => 0.5, baselinePassRate: 0.5 });
  expect(flat.decision).toBe("reject");
  const regress = await evaluateDelta(delta, { evalRunner: async () => 0.3, baselinePassRate: 0.5 });
  expect(regress.decision).toBe("reject");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/loop/self-improve/__tests__/apply.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/loop/self-improve/apply.ts
import type { ConfigDelta } from "./config-rewriter";
import type { TraceStore } from "../trace-store";
import { deriveGoal } from "../goal";

export type EvalRunner = (delta: ConfigDelta) => Promise<number>;

export interface EvalDecision {
  deltaId: string;
  decision: "accept" | "reject";
  before: number;
  after: number;
  reason: string;
}

export async function evaluateDelta(
  delta: ConfigDelta,
  opts: { evalRunner: EvalRunner; baselinePassRate: number },
): Promise<EvalDecision> {
  const after = await opts.evalRunner(delta);
  const before = opts.baselinePassRate;
  const decision: EvalDecision["decision"] = after > before ? "accept" : "reject";
  const reason =
    decision === "accept"
      ? `Improved pass-rate ${before} -> ${after}`
      : `Did not improve (${before} -> ${after}); rejecting to avoid regression.`;
  return { deltaId: delta.id, decision, before, after, reason };
}

/** Record a self-improve decision as a synthetic trace so it is observable to future cycles. */
export function recordDecision(
  traceStore: TraceStore,
  decision: EvalDecision,
  delta: ConfigDelta,
): void {
  const rec = traceStore.open(`self-improve-${decision.deltaId}`, deriveGoal("self-improvement"));
  traceStore.appendIteration(rec.traceId, {
    index: 0,
    agentOutput: `${decision.decision}: ${delta.patch}`,
    verification: [{ step: "eval", passed: decision.decision === "accept", output: decision.reason }],
    decision: decision.decision === "accept" ? "pass" : "escalate",
  });
  traceStore.finalize(rec.traceId, decision.decision === "accept" ? "passed" : "escalated");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/loop/self-improve/__tests__/apply.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/loop/self-improve/apply.ts src/loop/self-improve/__tests__/apply.test.ts
git commit -m "feat(loop): add eval-gated apply for config deltas (L4)"
```

---

## Task 4: Orchestrator + trigger

**Files:**
- Create: `src/loop/self-improve/orchestrator.ts`
- Modify: `src/webapp.ts` (env-gated `POST /loop/self-improve`)
- Test: `src/loop/self-improve/__tests__/orchestrator.test.ts`

**Interfaces:**
- Produces: `runSelfImprovementCycle(deps: { traceStore: TraceStore; evalRunner: EvalRunner; hitlStore?: HITLStore; enabled?: boolean }): Promise<{ report: AnalysisReport; deltas: ConfigDelta[]; decisions: EvalDecision[] }>`. Reads all traces, analyzes, proposes deltas, evaluates each, records decisions, and for accepted deltas creates a HITL request (no auto-apply). No-op when `enabled !== true` (default off).

- [ ] **Step 1: Write the failing test**

```ts
// src/loop/self-improve/__tests__/orchestrator.test.ts
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runSelfImprovementCycle } from "../orchestrator";
import { createTraceStore } from "../../trace-store";
import { createHITLStore } from "../../hitl";
import { deriveGoal } from "../../goal";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "si-")); });

test("disabled by default is a no-op", async () => {
  const ts = createTraceStore(dir);
  const res = await runSelfImprovementCycle({ traceStore: ts, evalRunner: async () => 0.9 });
  expect(res.deltas).toEqual([]);
});

test("end-to-end: analyze -> propose -> eval-gate -> record + HITL for accepted", async () => {
  const ts = createTraceStore(dir);
  // seed an import-error failure trace
  const rec = ts.open("t1", deriveGoal("x"));
  ts.appendIteration(rec.traceId, {
    index: 0, agentOutput: "",
    verification: [{ step: "run_tests", passed: false, output: "Cannot find module './z'" }],
    decision: "escalate",
  });
  ts.finalize(rec.traceId, "escalated");

  const res = await runSelfImprovementCycle({
    traceStore: ts,
    evalRunner: async () => 0.9, // improves over baseline 0 -> accept
    hitlStore: createHITLStore(),
    enabled: true,
  });
  expect(res.report.totalRuns).toBeGreaterThanOrEqual(1);
  expect(res.deltas.length).toBeGreaterThanOrEqual(1);
  expect(res.decisions.some((d) => d.decision === "accept")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/loop/self-improve/__tests__/orchestrator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3a: Write the orchestrator**

```ts
// src/loop/self-improve/orchestrator.ts
import type { TraceStore } from "../trace-store";
import type { HITLStore } from "../hitl";
import { analyze, type AnalysisReport } from "./analyzer";
import { proposeDeltas, type ConfigDelta } from "./config-rewriter";
import { evaluateDelta, recordDecision, type EvalRunner, type EvalDecision } from "./apply";

export interface SelfImprovementDeps {
  traceStore: TraceStore;
  evalRunner: EvalRunner;
  hitlStore?: HITLStore;
  enabled?: boolean;
}

export interface SelfImprovementResult {
  report: AnalysisReport;
  deltas: ConfigDelta[];
  decisions: EvalDecision[];
}

export async function runSelfImprovementCycle(
  deps: SelfImprovementDeps,
): Promise<SelfImprovementResult> {
  const enabled = deps.enabled ?? process.env.LOOP_SELF_IMPROVE_ENABLED === "true";
  if (!enabled) {
    return { report: analyze([]), deltas: [], decisions: [] };
  }

  const traces = deps.traceStore.queryAll();
  const report = analyze(traces);
  const deltas = proposeDeltas(report);
  const decisions: EvalDecision[] = [];

  for (const delta of deltas) {
    const decision = await evaluateDelta(delta, {
      evalRunner: deps.evalRunner,
      baselinePassRate: report.passRate,
    });
    recordDecision(deps.traceStore, decision, delta);
    decisions.push(decision);
    if (decision.decision === "accept" && deps.hitlStore) {
      deps.hitlStore.create({
        threadId: `self-improve-${delta.id}`,
        traceId: delta.id,
        reason: `Accepted config delta (${delta.sourcePattern}); awaiting approval to apply: ${delta.patch.slice(0, 120)}`,
        pendingAction: "apply_config_delta",
        options: ["approve", "reject", "modify"],
      });
    }
  }

  return { report, deltas, decisions };
}
```

- [ ] **Step 3b: Add the env-gated HTTP trigger in `webapp.ts`**

```ts
import { runSelfImprovementCycle } from "./loop/self-improve/orchestrator";
import { getLoopRunner } from "./server";

app.post("/loop/self-improve", async (c) => {
  if (process.env.LOOP_SELF_IMPROVE_ENABLED !== "true") {
    return c.json({ error: "self-improvement is disabled (set LOOP_SELF_IMPROVE_ENABLED=true)" }, 403);
  }
  const runner = getLoopRunner();
  // Default eval runner: a real EvalHarness run is heavy; for v1 we expose the cycle
  // with a placeholder eval runner that returns the current pass-rate (no change => reject),
  // so the endpoint is safe by default. Operators inject a real evalRunner via code.
  const res = await runSelfImprovementCycle({
    traceStore: runner.traceStore,
    evalRunner: async () => {
      const traces = runner.traceStore.queryAll();
      const passed = traces.filter((t) => t.outcome === "passed").length;
      return traces.length ? passed / traces.length : 0;
    },
    hitlStore: runner.hitlStore,
    enabled: true,
  });
  return c.json(res);
});
```

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test src/loop/self-improve/ src/loop/`
Expected: PASS; no new failures in `bun test src/__tests__/webapp.test.ts`.
Run: `bunx tsc --noEmit`
Expected: clean in real code.

- [ ] **Step 5: Commit**

```bash
git add src/loop/self-improve/orchestrator.ts src/loop/self-improve/__tests__/orchestrator.test.ts src/webapp.ts
git commit -m "feat(loop): add self-improvement orchestrator + env-gated HTTP trigger (L4)"
```

---

## Definition of Done (Plan 3 / L4)

- All 4 tasks green; `bun test src/loop/` passes (incl. self-improve suite); `bunx tsc --noEmit` clean in real code.
- `POST /loop/self-improve` (with `LOOP_SELF_IMPROVE_ENABLED=true`) analyzes traces, proposes eval-gated deltas, records decisions, and HITL-requests accepted deltas — **without** mutating real harness config (v1 responsible default).
- Off by default; zero behavior change otherwise.

## Notes for the executor

- `queryAll()` is the only change to `src/loop/trace-store.ts` — additive, must not disturb the L2 trace-store tests.
- The rewriter is deterministic (templates). Do NOT add an LLM call in v1.
- The default HTTP-trigger `evalRunner` intentionally returns the current pass-rate (so deltas reject unless an operator wires a real eval) — this keeps the endpoint safe. Document this in the route.
- No task may auto-edit harness config files, agent prompts, or `agent-factory.ts`. v1 only proposes + eval-gates + records + HITL-requests.
