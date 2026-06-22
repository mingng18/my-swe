# Loop Engineering — L1+L2 Core Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `runCodeagentTurn` through a bounded verify→fix→escalate loop (via a new `LoopRunner`) so every task self-closes, with durable resume-safe state, queryable traces, and Telegram+HTTP human-in-the-loop gates.

**Architecture:** A `LoopRunner` (new, in `src/loop/`) compiles the existing `BlueprintCompiler.compileWithFeedbackLoop` graph. A `HarnessAgentExecutor` adapts the pluggable harness to the compiler's `AgentExecutor`. A `buildVerifyRegistry` wires **sandbox-based** verification actions under the **compiler-expected** names. The compiler's agent node is fixed to increment `iteration` and inject failure feedback (the real infinite-loop bug). `state-store` + `trace-store` make the loop resume-safe and observable; `hitl` pauses for humans. `runCodeagentTurn` delegates to the runner only when `LOOP_ENABLED`; the legacy one-shot path is untouched otherwise.

**Tech Stack:** TypeScript, Bun (`bun:test`, `bun:sqlite`), LangGraph (`@langchain/langgraph`), existing harness/blueprint code. No new runtime deps (Bun ships `bun:sqlite`).

**Spec:** [`docs/superpowers/specs/2026-06-20-loop-engineering-design.md`](../specs/2026-06-20-loop-engineering-design.md)

## Global Constraints

- **Gate:** `bun test` must stay green (the documented pre-existing failures in `docs/test-suite-survey.md` are acceptable; introduce no *new* failures) and `bunx tsc --noEmit` must be clean after each task.
- New code lives in `src/loop/`. Shared edits are thin and called out per task: `src/server.ts` (1 delegation), `src/blueprints/compiler.ts` (agent-node + verify-node + terminal-node fixes), `src/blueprints/state.ts` (additive fields only), `src/webapp.ts` (2 routes), `src/index.ts` + `src/utils/telegram.ts` (HITL keyboard).
- **Env-gated:** the new path activates only when `LOOP_ENABLED=true`; unset = the existing one-shot `runCodeagentTurn` behavior, byte-for-byte.
- **Additive only** on `BlueprintStateAnnotation` — never remove or reorder existing fields (reducers must stay).
- **Deterministic verification runs in the sandbox**, never on the host. Never register the host-based builtins (`actions.ts:registerBuiltinActions`) for the loop.
- **TDD per task:** write the failing test → run it and see it fail → write minimal code → run and see it pass → commit. No skipping.
- `new Date()` / `Date.now()` are fine in application code (the Workflow-sandbox restriction does not apply here — `src/eval/harness.ts` already uses `new Date().toISOString()`).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/loop/goal.ts` | `GoalSpec`, `deriveGoal(task, opts)` — the termination contract |
| `src/loop/trace-store.ts` | `TraceStore`: JSONL-per-run + `bun:sqlite` index; `open`/`appendIteration`/`finalize`/`get`/`queryByThread` |
| `src/loop/state-store.ts` | `LoopState` + `StateStore`: durable per-thread resume state |
| `src/loop/verify-registry.ts` | `buildVerifyRegistry(getSandbox, profile)` — sandbox actions under compiler names |
| `src/loop/harness-executor.ts` | `createHarnessAgentExecutor(getHarness, opts)` — `AgentExecutor` over the harness |
| `src/blueprints/state.ts` *(modify)* | Additive `goal?`, `traceId?`, `loopOutcome?` fields |
| `src/blueprints/compiler.ts` *(modify)* | Fix agent node (iteration + feedback), profile-driven verify, terminal `loopOutcome`, drop legacy auto-PR-on-escalate |
| `src/loop/hitl.ts` | `HITLRequest` + `HITLStore` (create/get/resolve) |
| `src/loop/runner.ts` | `createLoopRunner(deps).run(input)` — composes everything |
| `src/server.ts` *(modify)* | `runCodeagentTurn` delegates to `LoopRunner` when `LOOP_ENABLED` |
| `src/webapp.ts` *(modify)* | `GET /loop/:threadId/status`, `POST /loop/:threadId/resume` |
| `src/index.ts` + `src/utils/telegram.ts` *(modify)* | Inline approve/reject keyboard for HITL |
| `src/loop/__tests__/*.test.ts` | One test file per module + `runner.integration.test.ts` |

**Task dependency order:** 1→2→3 (independent stores) → 4→5 → 6 (compiler fix needs goal+state) → 7 → 8 (needs all) → 9 → 10.

---

## Task 1: GoalSpec + `deriveGoal`

**Files:**
- Create: `src/loop/goal.ts`
- Test: `src/loop/__tests__/goal.test.ts`

**Interfaces:**
- Produces: `export type VerifyProfile = "tests" | "tests+lint" | "tests+lint+typecheck" | "eval"`; `export type AutonomyLevel = "report" | "assisted" | "unattended"`; `export interface GoalSpec { objective: string; acceptanceCriteria: string[]; maxIterations: number; budgetCeiling?: { tokens?: number; cost?: number }; autonomyLevel: AutonomyLevel; verifyProfile: VerifyProfile }`; `export function deriveGoal(task: string, opts?: { maxIterations?: number; verifyProfile?: VerifyProfile; autonomyLevel?: AutonomyLevel }): GoalSpec`. Later tasks import `GoalSpec`, `VerifyProfile`, `AutonomyLevel` from here.

- [ ] **Step 1: Write the failing test**

```ts
// src/loop/__tests__/goal.test.ts
import { test, expect } from "bun:test";
import { deriveGoal, type VerifyProfile } from "../goal";

test("deriveGoal applies defaults from env fallbacks", () => {
  const g = deriveGoal("fix the login bug");
  expect(g.objective).toBe("fix the login bug");
  expect(g.maxIterations).toBe(3); // LOOP_MAX_ITERATIONS default
  expect(g.autonomyLevel).toBe("assisted"); // default
  expect(g.verifyProfile).toBe("tests+lint"); // default
  expect(g.acceptanceCriteria).toContain("tests pass");
  expect(g.acceptanceCriteria).toContain("lint clean");
  expect(g.acceptanceCriteria).not.toContain("typecheck clean");
});

test("deriveGoal maps verifyProfile to acceptanceCriteria and honors opts", () => {
  const g = deriveGoal("t", {
    maxIterations: 5,
    verifyProfile: "tests+lint+typecheck" as VerifyProfile,
    autonomyLevel: "unattended",
  });
  expect(g.maxIterations).toBe(5);
  expect(g.autonomyLevel).toBe("unattended");
  expect(g.acceptanceCriteria).toEqual([
    "tests pass",
    "lint clean",
    "typecheck clean",
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/loop/__tests__/goal.test.ts`
Expected: FAIL — `Cannot find module '../goal'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/loop/goal.ts
export type VerifyProfile = "tests" | "tests+lint" | "tests+lint+typecheck" | "eval";
export type AutonomyLevel = "report" | "assisted" | "unattended";

export interface GoalSpec {
  objective: string;
  acceptanceCriteria: string[];
  maxIterations: number;
  budgetCeiling?: { tokens?: number; cost?: number };
  autonomyLevel: AutonomyLevel;
  verifyProfile: VerifyProfile;
}

export interface DeriveGoalOptions {
  maxIterations?: number;
  verifyProfile?: VerifyProfile;
  autonomyLevel?: AutonomyLevel;
}

export function deriveGoal(task: string, opts: DeriveGoalOptions = {}): GoalSpec {
  const maxIterations =
    opts.maxIterations ??
    Number(process.env.LOOP_MAX_ITERATIONS ?? "3");
  const autonomyLevel =
    opts.autonomyLevel ??
    ((process.env.LOOP_AUTONOMY_LEVEL as AutonomyLevel | undefined) ??
      "assisted");
  const verifyProfile: VerifyProfile = opts.verifyProfile ?? "tests+lint";

  const acceptanceCriteria: string[] = ["tests pass"];
  if (verifyProfile.includes("lint")) acceptanceCriteria.push("lint clean");
  if (verifyProfile.includes("typecheck"))
    acceptanceCriteria.push("typecheck clean");

  return {
    objective: task,
    acceptanceCriteria,
    maxIterations,
    autonomyLevel,
    verifyProfile,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/loop/__tests__/goal.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/loop/goal.ts src/loop/__tests__/goal.test.ts
git commit -m "feat(loop): add GoalSpec + deriveGoal (L1 termination contract)"
```

---

## Task 2: TraceStore (JSONL + SQLite index)

**Files:**
- Create: `src/loop/trace-store.ts`
- Test: `src/loop/__tests__/trace-store.test.ts`

**Interfaces:**
- Consumes: `GoalSpec` from `./goal`; `VerificationResult` (`{ step, passed, output }`) from `../blueprints/state`.
- Produces: `IterationRecord { index, agentOutput, verification: VerificationResult[], feedbackInjected?, decision: "retry"|"pass"|"escalate"|"hitl" }`; `TraceRecord { traceId, threadId, goal, startedAt, endedAt?, iterations, outcome }`; `TraceStore` with `open(threadId, goal)`, `appendIteration(traceId, iter)`, `finalize(traceId, outcome)`, `get(traceId)`, `queryByThread(threadId)`. Runner (Task 8) uses all of these.

- [ ] **Step 1: Write the failing test**

```ts
// src/loop/__tests__/trace-store.test.ts
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createTraceStore } from "../trace-store";
import { deriveGoal } from "../goal";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "trace-"));
});

test("open/append/finalize persists and is queryable", () => {
  const ts = createTraceStore(dir);
  const goal = deriveGoal("t");
  const rec = ts.open("thread1", goal);
  expect(rec.outcome).toBe("running");
  expect(rec.traceId).toBeTruthy();

  ts.appendIteration(rec.traceId, {
    index: 0,
    agentOutput: "did x",
    verification: [],
    decision: "pass",
  });
  ts.finalize(rec.traceId, "passed");

  const got = ts.get(rec.traceId);
  expect(got?.outcome).toBe("passed");
  expect(got?.iterations).toHaveLength(1);

  const list = ts.queryByThread("thread1");
  expect(list).toHaveLength(1);
  expect(list[0].traceId).toBe(rec.traceId);
});

test("queryByThread returns only that thread", () => {
  const ts = createTraceStore(dir);
  const a = ts.open("t-a", deriveGoal("a"));
  const b = ts.open("t-b", deriveGoal("b"));
  ts.finalize(a.traceId, "passed");
  ts.finalize(b.traceId, "escalated");
  expect(ts.queryByThread("t-a").map((r) => r.outcome)).toEqual(["passed"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/loop/__tests__/trace-store.test.ts`
Expected: FAIL — `Cannot find module '../trace-store'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/loop/trace-store.ts
import { mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { Database } from "bun:sqlite";
import type { GoalSpec } from "./goal";
import type { VerificationResult } from "../blueprints/state";

export interface IterationRecord {
  index: number;
  agentOutput: string;
  verification: VerificationResult[];
  feedbackInjected?: string;
  decision: "retry" | "pass" | "escalate" | "hitl";
}

export type TraceOutcome = "passed" | "escalated" | "hitl_paused" | "error" | "running";

export interface TraceRecord {
  traceId: string;
  threadId: string;
  goal: GoalSpec;
  startedAt: string;
  endedAt?: string;
  iterations: IterationRecord[];
  outcome: TraceOutcome;
}

export interface TraceStore {
  open(threadId: string, goal: GoalSpec): TraceRecord;
  appendIteration(traceId: string, iter: IterationRecord): void;
  finalize(traceId: string, outcome: TraceOutcome): void;
  get(traceId: string): TraceRecord | undefined;
  queryByThread(threadId: string): TraceRecord[];
}

function defaultDir(): string {
  return process.env.LOOP_TRACE_DIR ??
    join(process.env.WORKSPACE_ROOT ?? process.cwd(), "loop-traces");
}

function traceFile(dir: string, traceId: string): string {
  return join(dir, `${traceId}.jsonl`);
}

export function createTraceStore(dir: string = defaultDir()): TraceStore {
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, "index.sqlite"));
  db.run(
    `CREATE TABLE IF NOT EXISTS traces (
      traceId TEXT PRIMARY KEY,
      threadId TEXT,
      outcome TEXT,
      startedAt TEXT,
      endedAt TEXT,
      record TEXT
    )`,
  );
  db.run(`CREATE INDEX IF NOT EXISTS idx_thread ON traces(threadId)`);

  const live = new Map<string, TraceRecord>();
  let counter = 0;
  const newId = () =>
    `trace_${Date.now().toString(36)}_${(counter += 1)}`;

  return {
    open(threadId, goal) {
      const rec: TraceRecord = {
        traceId: newId(),
        threadId,
        goal,
        startedAt: new Date().toISOString(),
        iterations: [],
        outcome: "running",
      };
      live.set(rec.traceId, rec);
      appendFileSync(
        traceFile(dir, rec.traceId),
        JSON.stringify({ event: "open", ...rec }) + "\n",
      );
      return rec;
    },
    appendIteration(traceId, iter) {
      const rec = live.get(traceId);
      if (!rec) return;
      rec.iterations.push(iter);
      appendFileSync(
        traceFile(dir, traceId),
        JSON.stringify({ event: "iteration", ...iter }) + "\n",
      );
    },
    finalize(traceId, outcome) {
      const rec = live.get(traceId);
      if (!rec) return;
      rec.outcome = outcome;
      rec.endedAt = new Date().toISOString();
      db.run(
        `INSERT OR REPLACE INTO traces (traceId, threadId, outcome, startedAt, endedAt, record)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          rec.traceId,
          rec.threadId,
          rec.outcome,
          rec.startedAt,
          rec.endedAt ?? "",
          JSON.stringify(rec),
        ],
      );
    },
    get(traceId) {
      const row = db
        .query(`SELECT record FROM traces WHERE traceId = ?`)
        .get(traceId) as { record?: string } | undefined;
      if (row?.record) return JSON.parse(row.record) as TraceRecord;
      return live.get(traceId);
    },
    queryByThread(threadId) {
      const rows = db
        .query(`SELECT record FROM traces WHERE threadId = ? ORDER BY startedAt ASC`)
        .all(threadId) as { record: string }[];
      return rows.map((r) => JSON.parse(r.record) as TraceRecord);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/loop/__tests__/trace-store.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/loop/trace-store.ts src/loop/__tests__/trace-store.test.ts
git commit -m "feat(loop): add TraceStore (JSONL + bun:sqlite index)"
```

---

## Task 3: StateStore (durable resume state)

**Files:**
- Create: `src/loop/state-store.ts`
- Test: `src/loop/__tests__/state-store.test.ts`

**Interfaces:**
- Consumes: `GoalSpec` from `./goal`.
- Produces: `LoopState { threadId, goal, iteration, done: string[], next: string[], tried: string[], lastError?, hitl?: { requestId, reason, pendingAction }, traceId, updatedAt }`; `StateStore { load(threadId): LoopState|undefined; save(state): void; clear(threadId): void }`; `createStateStore(dir?)`. Runner (Task 8) reads prior state at start and writes after each run.

- [ ] **Step 1: Write the failing test**

```ts
// src/loop/__tests__/state-store.test.ts
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createStateStore } from "../state-store";
import { deriveGoal } from "../goal";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "state-"));
});

test("save/load round-trips LoopState", () => {
  const ss = createStateStore(dir);
  const goal = deriveGoal("t");
  ss.save({
    threadId: "th1",
    goal,
    iteration: 2,
    done: ["a"],
    next: ["b"],
    tried: ["a"],
    traceId: "trace_x",
    updatedAt: new Date().toISOString(),
  });
  const loaded = ss.load("th1");
  expect(loaded?.iteration).toBe(2);
  expect(loaded?.done).toEqual(["a"]);
  expect(loaded?.goal.objective).toBe("t");
});

test("load returns undefined when absent; clear removes", () => {
  const ss = createStateStore(dir);
  expect(ss.load("nope")).toBeUndefined();
  ss.save({ threadId: "th2", goal: deriveGoal("t"), iteration: 0, done: [], next: [], tried: [], traceId: "t1", updatedAt: "" });
  expect(ss.load("th2")).toBeDefined();
  ss.clear("th2");
  expect(ss.load("th2")).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/loop/__tests__/state-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/loop/state-store.ts
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import type { GoalSpec } from "./goal";

export interface LoopState {
  threadId: string;
  goal: GoalSpec;
  iteration: number;
  done: string[];
  next: string[];
  tried: string[];
  lastError?: string;
  hitl?: { requestId: string; reason: string; pendingAction: string };
  traceId: string;
  updatedAt: string;
}

export interface StateStore {
  load(threadId: string): LoopState | undefined;
  save(state: LoopState): void;
  clear(threadId: string): void;
}

function defaultDir(): string {
  return process.env.LOOP_STATE_DIR ??
    join(process.env.WORKSPACE_ROOT ?? process.cwd(), "loop-state");
}

function file(dir: string, threadId: string): string {
  return join(dir, `${threadId}.json`);
}

export function createStateStore(dir: string = defaultDir()): StateStore {
  mkdirSync(dir, { recursive: true });
  return {
    load(threadId) {
      const f = file(dir, threadId);
      if (!existsSync(f)) return undefined;
      return JSON.parse(readFileSync(f, "utf-8")) as LoopState;
    },
    save(state) {
      writeFileSync(
        file(dir, state.threadId),
        JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2),
      );
    },
    clear(threadId) {
      const f = file(dir, threadId);
      if (existsSync(f)) unlinkSync(f);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/loop/__tests__/state-store.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/loop/state-store.ts src/loop/__tests__/state-store.test.ts
git commit -m "feat(loop): add durable StateStore for resume-safe loop state"
```

---

## Task 4: `buildVerifyRegistry` (sandbox actions under compiler names)

**Files:**
- Create: `src/loop/verify-registry.ts`
- Test: `src/loop/__tests__/verify-registry.test.ts`

**Interfaces:**
- Consumes: `ActionRegistry` from `../blueprints/actions`; the `createVerify*Action`/`createCreatePrAction` creators + `SandboxAccessor` type from `../blueprints/verification-actions`; `VerifyProfile` from `./goal`.
- Produces: `buildVerifyRegistry(getSandbox: SandboxAccessor, profile?: VerifyProfile): ActionRegistry` registering `run_tests`, `run_linters`, (optionally `run_typecheck`), and `create_pr` — each backed by the **sandbox** creators. Runner (Task 8) calls this.

- [ ] **Step 1: Write the failing test**

```ts
// src/loop/__tests__/verify-registry.test.ts
import { test, expect } from "bun:test";
import { buildVerifyRegistry } from "../verify-registry";
import type { SandboxAccessor } from "../../blueprints/verification-actions";

const noSandbox: SandboxAccessor = async () => undefined;

test("registers compiler-expected sandbox-backed names for tests+lint", () => {
  const reg = buildVerifyRegistry(noSandbox, "tests+lint");
  expect(reg.has("run_tests")).toBe(true);
  expect(reg.has("run_linters")).toBe(true);
  expect(reg.has("create_pr")).toBe(true);
  expect(reg.has("run_typecheck")).toBe(false);
});

test("tests+lint+typecheck profile also registers run_typecheck", () => {
  const reg = buildVerifyRegistry(noSandbox, "tests+lint+typecheck");
  expect(reg.has("run_typecheck")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/loop/__tests__/verify-registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/loop/verify-registry.ts
import { ActionRegistry } from "../blueprints/actions";
import type { DeterministicAction } from "../blueprints/types";
import {
  createVerifyTestsAction,
  createVerifyLintAction,
  createVerifyTypecheckAction,
  createCreatePrAction,
  type SandboxAccessor,
} from "../blueprints/verification-actions";
import type { VerifyProfile } from "./goal";

/**
 * Build the verify ActionRegistry for the loop.
 *
 * `compileWithFeedbackLoop`'s verify node looks actions up by name; this
 * registers the SANDBOX-backed verification creators under exactly the names
 * the verify node (Task 6) queries — `run_tests`, `run_linters`, and (when the
 * profile includes typecheck) `run_typecheck` — plus `create_pr`. We deliberately
 * do NOT use `registerBuiltinActions()` (host-execFile): loop verification must
 * run inside the sandbox.
 */
export function buildVerifyRegistry(
  getSandbox: SandboxAccessor,
  profile: VerifyProfile = "tests+lint",
): ActionRegistry {
  const reg = new ActionRegistry();
  const rename = (a: DeterministicAction, name: string): DeterministicAction => ({
    ...a,
    name,
  });
  reg.register(rename(createVerifyTestsAction(getSandbox), "run_tests"));
  reg.register(rename(createVerifyLintAction(getSandbox), "run_linters"));
  if (profile.includes("typecheck")) {
    reg.register(rename(createVerifyTypecheckAction(getSandbox), "run_typecheck"));
  }
  reg.register(rename(createCreatePrAction(getSandbox), "create_pr"));
  return reg;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/loop/__tests__/verify-registry.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/loop/verify-registry.ts src/loop/__tests__/verify-registry.test.ts
git commit -m "feat(loop): add buildVerifyRegistry wiring sandbox actions to compiler names"
```

---

## Task 5: `HarnessAgentExecutor`

**Files:**
- Create: `src/loop/harness-executor.ts`
- Test: `src/loop/__tests__/harness-executor.test.ts`

**Interfaces:**
- Consumes: `AgentExecutor` (`{ execute(input, config): Promise<{ output: string; messages: unknown[] }> }`) from `../blueprints/compiler`; `AgentHarness`, `AgentInvokeOptions` from `../harness`.
- Produces: `createHarnessAgentExecutor(getHarness: () => Promise<AgentHarness>, opts?: AgentInvokeOptions): AgentExecutor`. The executor is a pure adapter — feedback injection + iteration bookkeeping live in the compiler's agent node (Task 6), not here. Runner (Task 8) constructs it.

- [ ] **Step 1: Write the failing test**

```ts
// src/loop/__tests__/harness-executor.test.ts
import { test, expect } from "bun:test";
import { createHarnessAgentExecutor } from "../harness-executor";
import type { AgentHarness } from "../../harness";

test("delegates input to the harness and maps reply->output", async () => {
  const fakeHarness = {
    run: async (input: string) => ({ reply: `echo:${input}` }),
  } as unknown as AgentHarness;
  const exec = createHarnessAgentExecutor(async () => fakeHarness, {
    threadId: "t1",
  });
  const out = await exec.execute("hello", { models: [], tools: [] });
  expect(out.output).toBe("echo:hello");
  expect(out.messages).toEqual([]);
});

test("falls back to error text when reply is empty", async () => {
  const fakeHarness = {
    run: async () => ({ reply: "", error: "boom" }),
  } as unknown as AgentHarness;
  const exec = createHarnessAgentExecutor(async () => fakeHarness);
  const out = await exec.execute("x", { models: [], tools: [] });
  expect(out.output).toBe("boom");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/loop/__tests__/harness-executor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/loop/harness-executor.ts
import type { AgentExecutor } from "../blueprints/compiler";
import type { AgentHarness, AgentInvokeOptions } from "../harness";

/**
 * Adapts the pluggable AgentHarness to BlueprintCompiler's AgentExecutor.
 * Pure delegation — per-iteration feedback and iteration counting are handled
 * by the compiler's agent node (which has graph-state access).
 */
export function createHarnessAgentExecutor(
  getHarness: () => Promise<AgentHarness>,
  opts: AgentInvokeOptions = {},
): AgentExecutor {
  return {
    execute: async (input, _config) => {
      const harness = await getHarness();
      const res = await harness.run(input, {
        threadId: opts.threadId,
        userId: opts.userId,
        transport: opts.transport,
      });
      return {
        output: res.reply ?? res.error ?? "(empty reply)",
        messages: res.messages ?? [],
      };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/loop/__tests__/harness-executor.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/loop/harness-executor.ts src/loop/__tests__/harness-executor.test.ts
git commit -m "feat(loop): add HarnessAgentExecutor adapter over the pluggable harness"
```

---

## Task 6: Fix the feedback-loop graph (iteration + feedback + profile + outcome)

**This is the core bug-fix task.** It makes the dead `compileWithFeedbackLoop` actually loop correctly. Modifies two files.

**Files:**
- Modify: `src/blueprints/state.ts` (additive fields)
- Modify: `src/blueprints/compiler.ts` (agent node, verify node, create_pr node, escalate node)
- Test: `src/blueprints/__tests__/feedback-loop.test.ts`

**Interfaces:**
- Consumes: `GoalSpec` from `../loop/goal` (type-only import in `state.ts`); `AgentExecutor`, `ActionRegistry` already on the compiler.
- Produces: `BlueprintStateAnnotation` gains optional `goal?: GoalSpec`, `traceId?: string`, `loopOutcome?: "passed" | "escalated"`. `compileWithFeedbackLoop(maxRetries)` now: (a) agent node returns `{ iteration: (state.iteration ?? 0) + 1 }` and prepends prior-failure feedback to the input on retries; (b) verify node runs the action set implied by `state.goal.verifyProfile`; (c) `create_pr` sets `loopOutcome: "passed"`; (d) `escalate` sets `loopOutcome: "escalated"` and **no longer auto-creates a PR** (the runner decides HITL vs finalize).

- [ ] **Step 1: Write the failing test**

```ts
// src/blueprints/__tests__/feedback-loop.test.ts
import { test, expect } from "bun:test";
import { BlueprintCompiler, type AgentExecutor } from "../compiler";
import { ActionRegistry } from "../actions";
import type { GoalSpec } from "../../loop/goal";

function registryWith(passTests: () => boolean) {
  const reg = new ActionRegistry();
  reg.register({
    name: "run_tests",
    description: "",
    execute: async () =>
      passTests()
        ? { success: true, output: "ok" }
        : { success: false, output: "tests failed" },
  });
  reg.register({
    name: "run_linters",
    description: "",
    execute: async () => ({ success: true, output: "lint ok" }),
  });
  reg.register({
    name: "create_pr",
    description: "",
    execute: async () => ({ success: true, output: "pr created" }),
  });
  return reg;
}

const baseGoal: GoalSpec = {
  objective: "fix",
  acceptanceCriteria: ["tests pass"],
  maxIterations: 2,
  autonomyLevel: "assisted",
  verifyProfile: "tests",
};

test("loop terminates at escalate (no infinite loop) and increments iteration", async () => {
  const reg = registryWith(() => false); // tests never pass
  const calls: string[] = [];
  const exec: AgentExecutor = {
    execute: async (input) => {
      calls.push(input);
      return { output: "attempt", messages: [] };
    },
  };
  const graph = new BlueprintCompiler(reg, exec).compileWithFeedbackLoop(2);

  const result = (await graph.invoke(
    {
      input: "fix the bug",
      currentState: "agent",
      goal: baseGoal,
      iteration: 0,
      maxIterations: 2,
      verificationResults: [],
      agentMessages: [],
    } as any,
    { recursion_limit: 50 },
  )) as any;

  // Did not infinite-loop: reached a terminal within the recursion limit.
  expect(result.loopOutcome).toBe("escalated");
  expect(result.iteration).toBeGreaterThanOrEqual(2);
  // Escalate must NOT have auto-created a PR (create_pr only runs on pass).
  expect(result.lastResult?.success).toBe(false);
});

test("loop injects prior-failure feedback into the retry input", async () => {
  const reg = registryWith(() => false);
  const calls: string[] = [];
  const exec: AgentExecutor = {
    execute: async (input) => {
      calls.push(input);
      return { output: "attempt", messages: [] };
    },
  };
  const graph = new BlueprintCompiler(reg, exec).compileWithFeedbackLoop(2);
  await graph.invoke(
    {
      input: "fix the bug",
      currentState: "agent",
      goal: baseGoal,
      iteration: 0,
      maxIterations: 2,
      verificationResults: [],
      agentMessages: [],
    } as any,
    { recursion_limit: 50 },
  );
  expect(calls.length).toBe(2);
  expect(calls[1]).toContain("Previous attempt");
  expect(calls[1]).toContain("tests failed");
});

test("loop passes and sets loopOutcome=passed when verify succeeds", async () => {
  let n = 0;
  const reg = registryWith(() => ++n >= 2); // pass on 2nd verify
  const exec: AgentExecutor = {
    execute: async () => ({ output: "attempt", messages: [] }),
  };
  const graph = new BlueprintCompiler(reg, exec).compileWithFeedbackLoop(2);
  const result = (await graph.invoke(
    {
      input: "fix",
      currentState: "agent",
      goal: baseGoal,
      iteration: 0,
      maxIterations: 2,
      verificationResults: [],
      agentMessages: [],
    } as any,
    { recursion_limit: 50 },
  )) as any;
  expect(result.loopOutcome).toBe("passed");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/blueprints/__tests__/feedback-loop.test.ts`
Expected: FAIL — `loopOutcome` is undefined; the first test likely throws a recursion-limit error (infinite loop) or times out, proving the bug.

- [ ] **Step 3a: Add additive fields to the state annotation**

In `src/blueprints/state.ts`, add a type-only import and three optional fields inside `Annotation.Root({ ... })` (after `agentMessages`):

```ts
// at top of src/blueprints/state.ts
import type { GoalSpec } from "../loop/goal";

// inside Annotation.Root({ ... }), after the agentMessages field:
  goal: Annotation<GoalSpec | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  traceId: Annotation<string | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  loopOutcome: Annotation<"passed" | "escalated" | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
```

- [ ] **Step 3b: Rewrite the agent node to increment iteration + inject feedback**

In `src/blueprints/compiler.ts`, replace the `agent` node body inside `compileWithFeedbackLoop` (the `graph.addNode("agent", …)` block) with:

```ts
    graph.addNode(
      "agent",
      async (state: GraphState): Promise<Partial<GraphState>> => {
        const iteration = (state.iteration ?? 0) + 1;
        let input = state.input;
        const priorFailed = (state.verificationResults ?? []).filter(
          (r) => !r.passed,
        );
        if (priorFailed.length > 0) {
          const fb = priorFailed
            .map((r) => `- ${r.step}: ${r.output}`)
            .join("\n");
          input =
            `Previous attempt failed verification:\n${fb}\n\nPlease fix the failing checks and retry. Original task:\n${state.input}`;
        }
        try {
          const defaultConfig: AgentConfig = { models: [], tools: [] };
          const result = await agentExec.execute(input, defaultConfig);
          return {
            iteration,
            agentMessages: [
              ...(state.agentMessages ?? []),
              ...(result.messages ?? []),
            ],
            lastResult: { success: true, output: result.output },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error({ err }, "[compiler] Agent node failed");
          return {
            iteration,
            error: msg,
            lastResult: { success: false, error: msg },
          };
        }
      },
    );
```

- [ ] **Step 3c: Make the verify node profile-driven (and per-iteration)**

Replace the `verify` node body (the two hardcoded `actionReg.get("run_tests")` / `"run_linters"` blocks) with a profile-driven loop. **Important:** return *only this iteration's* results (do **not** spread `state.verificationResults`). The annotation reducer is last-write-wins, so this *replaces* the array each iteration — which is required, because `check_results` does `results.every(r => r.passed)` and an accumulated history would permanently contain old failures and never let a later pass count.

```ts
    graph.addNode(
      "verify",
      async (state: GraphState): Promise<Partial<GraphState>> => {
        const profile = state.goal?.verifyProfile ?? "tests+lint";
        const checks = ["run_tests"];
        if (profile.includes("lint")) checks.push("run_linters");
        if (profile.includes("typecheck")) checks.push("run_typecheck");

        // NOTE: do NOT accumulate — return only this iteration's results.
        const results: VerificationResult[] = [];
        for (const name of checks) {
          const action = actionReg.get(name);
          if (!action) continue;
          try {
            const r = await action.execute(state as BlueprintState);
            results.push({
              step: name,
              passed: r.success,
              output: r.output ?? r.error ?? "",
            });
          } catch (err) {
            results.push({
              step: name,
              passed: false,
              output: err instanceof Error ? err.message : String(err),
            });
          }
        }
        return { verificationResults: results };
      },
    );
```

- [ ] **Step 3d: `create_pr` sets `loopOutcome: "passed"`**

In the `create_pr` node, change the success return to include `loopOutcome`:

```ts
          try {
            const r = await prAction.execute(state as BlueprintState);
            return {
              loopOutcome: "passed",
              lastResult: r,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              loopOutcome: "passed",
              lastResult: { success: false, error: msg },
              error: msg,
            };
          }
```

- [ ] **Step 3e: `escalate` no longer auto-creates a PR; sets `loopOutcome`**

Replace the entire `escalate` node body with:

```ts
    graph.addNode(
      "escalate",
      async (state: GraphState): Promise<Partial<GraphState>> => {
        const failedSteps = (state.verificationResults ?? [])
          .filter((r) => !r.passed)
          .map((r) => r.step)
          .join(", ");
        logger.warn(
          { iteration: state.iteration, maxIterations: maxRetries, failedSteps },
          "[compiler] Escalating: max iterations reached",
        );
        return {
          loopOutcome: "escalated",
          error: `Escalated after ${state.iteration ?? maxRetries} iterations. Failed steps: ${failedSteps}`,
          lastResult: {
            success: false,
            error: `Max retries (${maxRetries}) exceeded. Failed: ${failedSteps}`,
          },
        };
      },
    );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/blueprints/__tests__/feedback-loop.test.ts`
Expected: PASS (3 tests). Also run the existing blueprint suite to confirm no regressions: `bun test src/blueprints/`. Expected: no *new* failures vs `docs/test-suite-survey.md`.

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 6: Commit**

```bash
git add src/blueprints/state.ts src/blueprints/compiler.ts src/blueprints/__tests__/feedback-loop.test.ts
git commit -m "fix(blueprints): feedback loop increments iteration, injects feedback, profile-driven verify, loopOutcome; drop legacy auto-PR-on-escalate"
```

---

## Task 7: HITL store + requests

**Files:**
- Create: `src/loop/hitl.ts`
- Test: `src/loop/__tests__/hitl.test.ts`

**Interfaces:**
- Produces: `HITLRequest { requestId, threadId, traceId, reason, pendingAction, options: ("approve"|"reject"|"modify")[] }`; `HITLStore { create(req): HITLRequest; get(id): HITLRequest|undefined; getByThread(thread): HITLRequest|undefined; resolve(id, decision, note?): HITLRequest|undefined }`; `createHITLStore()`. Runner (Task 8) creates requests; webapp/Telegram (Tasks 9-10) resolve them.

- [ ] **Step 1: Write the failing test**

```ts
// src/loop/__tests__/hitl.test.ts
import { test, expect } from "bun:test";
import { createHITLStore } from "../hitl";

test("create/get/resolve lifecycle", () => {
  const s = createHITLStore();
  const req = s.create({
    threadId: "t1",
    traceId: "tr1",
    reason: "verification failed",
    pendingAction: "create_pr",
    options: ["approve", "reject", "modify"],
  });
  expect(req.requestId).toBeTruthy();
  expect(s.get(req.requestId)?.threadId).toBe("t1");
  const resolved = s.resolve(req.requestId, "approve");
  expect(resolved?.requestId).toBe(req.requestId);
});

test("getByThread returns only unresolved requests", () => {
  const s = createHITLStore();
  const a = s.create({ threadId: "t", traceId: "x", reason: "r", pendingAction: "create_pr", options: ["approve"] });
  s.create({ threadId: "t", traceId: "y", reason: "r2", pendingAction: "create_pr", options: ["approve"] });
  expect(s.getByThread("t")?.traceId).toBe("x");
  s.resolve(a.requestId, "reject");
  // 'a' resolved; the other is still open
  expect(s.getByThread("t")?.traceId).toBe("y");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/loop/__tests__/hitl.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/loop/hitl.ts
import { randomUUID } from "crypto";

export interface HITLRequest {
  requestId: string;
  threadId: string;
  traceId: string;
  reason: string;
  pendingAction: string;
  options: ("approve" | "reject" | "modify")[];
}

type Stored = HITLRequest & { decision?: "approve" | "reject" | "modify" };

export interface HITLStore {
  create(req: Omit<HITLRequest, "requestId">): HITLRequest;
  get(requestId: string): HITLRequest | undefined;
  getByThread(threadId: string): HITLRequest | undefined;
  resolve(
    requestId: string,
    decision: "approve" | "reject" | "modify",
    note?: string,
  ): HITLRequest | undefined;
}

export function createHITLStore(): HITLStore {
  const map = new Map<string, Stored>();
  return {
    create(req) {
      const full: Stored = { ...req, requestId: randomUUID() };
      map.set(full.requestId, full);
      return full;
    },
    get: (id) => map.get(id),
    getByThread: (thread) => {
      for (const r of map.values()) {
        if (r.threadId === thread && !r.decision) return r;
      }
      return undefined;
    },
    resolve(id, decision) {
      const r = map.get(id);
      if (!r) return undefined;
      r.decision = decision;
      return r;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/loop/__tests__/hitl.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/loop/hitl.ts src/loop/__tests__/hitl.test.ts
git commit -m "feat(loop): add HITL store + request lifecycle"
```

---

## Task 8: `LoopRunner` (compose + compile + invoke + state + trace + HITL)

**Files:**
- Create: `src/loop/runner.ts`
- Test: `src/loop/__tests__/runner.integration.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-7; `BlueprintCompiler` + `getAgentHarness`; `SandboxAccessor` type.
- Produces: `createLoopRunner(deps?)` → `{ run(input: LoopRunInput): Promise<LoopRunResult>; hitlStore; stateStore; traceStore }`. `LoopRunInput { input, threadId, userId?, transport?, goal?: Partial<GoalSpec>, getSandbox?: SandboxAccessor }`. `LoopRunResult { reply, outcome: "passed"|"escalated"|"hitl_paused"|"error", traceId, iterations, hitl?: HITLRequest }`. Task 9 wires `runCodeagentTurn` to `run`.

- [ ] **Step 1: Write the failing test**

```ts
// src/loop/__tests__/runner.integration.test.ts
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ActionRegistry } from "../../blueprints/actions";
import { createLoopRunner } from "../runner";
import { createStateStore } from "../state-store";
import { createTraceStore } from "../trace-store";

let stateDir: string;
let traceDir: string;
beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "rs-"));
  traceDir = mkdtempSync(join(tmpdir(), "rt-"));
});

/** A verify registry whose run_tests passes only after `threshold` calls. */
function flakyRegistry(threshold: number, never = false) {
  const reg = new ActionRegistry();
  let calls = 0;
  reg.register({
    name: "run_tests",
    description: "",
    execute: async () => {
      calls += 1;
      return never || calls < threshold
        ? { success: false, output: "tests failed" }
        : { success: true, output: "ok" };
    },
  });
  reg.register({
    name: "run_linters",
    description: "",
    execute: async () => ({ success: true, output: "lint ok" }),
  });
  reg.register({
    name: "create_pr",
    description: "",
    execute: async () => ({ success: true, output: "pr created" }),
  });
  return reg;
}

const fakeHarness = async () => ({ run: async () => ({ reply: "done" }) }) as any;

test("loop retries and passes when verification eventually succeeds", async () => {
  const runner = createLoopRunner({
    getHarness: fakeHarness,
    buildRegistry: () => flakyRegistry(2), // pass on 2nd attempt
    hitlEnabled: false,
    stateStore: createStateStore(stateDir),
    traceStore: createTraceStore(traceDir),
  });
  const res = await runner.run({ input: "fix the bug", threadId: "pass-thread" });
  expect(res.outcome).toBe("passed");
  expect(res.iterations).toBeGreaterThanOrEqual(2);
});

test("loop escalates (no infinite loop) when verification never passes", async () => {
  const runner = createLoopRunner({
    getHarness: fakeHarness,
    buildRegistry: () => flakyRegistry(99, true), // never pass
    hitlEnabled: false,
    stateStore: createStateStore(stateDir),
    traceStore: createTraceStore(traceDir),
  });
  const res = await runner.run({
    input: "fix",
    threadId: "esc-thread",
    goal: { maxIterations: 2 },
  });
  expect(res.outcome).toBe("escalated");
  expect(res.iterations).toBe(2);
});

test("with HITL enabled, escalation pauses and returns a HITL request", async () => {
  const runner = createLoopRunner({
    getHarness: fakeHarness,
    buildRegistry: () => flakyRegistry(99, true),
    hitlEnabled: true,
    stateStore: createStateStore(stateDir),
    traceStore: createTraceStore(traceDir),
  });
  const res = await runner.run({
    input: "fix",
    threadId: "hitl-thread",
    goal: { maxIterations: 1 },
  });
  expect(res.outcome).toBe("hitl_paused");
  expect(res.hitl?.requestId).toBeTruthy();
  expect(res.hitl?.options).toContain("approve");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/loop/__tests__/runner.integration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/loop/runner.ts
import { BlueprintCompiler } from "../blueprints/compiler";
import { ActionRegistry } from "../blueprints/actions";
import { getAgentHarness } from "../harness";
import { deriveGoal, type GoalSpec, type VerifyProfile } from "./goal";
import { createHarnessAgentExecutor } from "./harness-executor";
import { buildVerifyRegistry } from "./verify-registry";
import {
  createStateStore,
  type StateStore,
  type LoopState,
} from "./state-store";
import {
  createTraceStore,
  type TraceStore,
  type IterationRecord,
  type TraceOutcome,
} from "./trace-store";
import {
  createHITLStore,
  type HITLStore,
  type HITLRequest,
} from "./hitl";
import type { SandboxAccessor } from "../blueprints/verification-actions";

export interface LoopRunInput {
  input: string;
  threadId: string;
  userId?: string;
  transport?: "telegram" | "http" | "github";
  goal?: Partial<GoalSpec>;
  getSandbox?: SandboxAccessor;
}

export interface LoopRunResult {
  reply: string;
  outcome: "passed" | "escalated" | "hitl_paused" | "error";
  traceId: string;
  iterations: number;
  hitl?: HITLRequest;
}

export interface LoopRunnerDeps {
  stateStore?: StateStore;
  traceStore?: TraceStore;
  hitlStore?: HITLStore;
  getHarness?: () => Promise<unknown>;
  getSandbox?: SandboxAccessor;
  /** Override the verify registry (tests). Default: buildVerifyRegistry. */
  buildRegistry?: (profile: VerifyProfile) => ActionRegistry;
  hitlEnabled?: boolean;
}

export function createLoopRunner(deps: LoopRunnerDeps = {}) {
  const stateStore = deps.stateStore ?? createStateStore();
  const traceStore = deps.traceStore ?? createTraceStore();
  const hitlStore = deps.hitlStore ?? createHITLStore();
  const hitlEnabled =
    deps.hitlEnabled ?? process.env.LOOP_HITL_ENABLED === "true";

  async function run(input: LoopRunInput): Promise<LoopRunResult> {
    const goal = deriveGoal(input.input, input.goal ?? {});
    const threadId = input.threadId;
    const getHarness = (deps.getHarness ?? (async () => getAgentHarness())) as () => Promise<any>;
    const getSandbox: SandboxAccessor =
      input.getSandbox ?? deps.getSandbox ?? (async () => undefined);

    const trace = traceStore.open(threadId, goal);
    const prior = stateStore.load(threadId);

    const executor = createHarnessAgentExecutor(getHarness, {
      threadId,
      userId: input.userId,
      transport: input.transport,
    });
    const buildRegistry =
      deps.buildRegistry ?? ((p: VerifyProfile) => buildVerifyRegistry(getSandbox, p));
    const registry = buildRegistry(goal.verifyProfile);
    const graph = new BlueprintCompiler(
      registry,
      executor,
    ).compileWithFeedbackLoop(goal.maxIterations);

    try {
      const finalState = (await graph.invoke(
        {
          input: input.input,
          currentState: "agent",
          goal,
          traceId: trace.traceId,
          iteration: prior?.iteration ?? 0,
          maxIterations: goal.maxIterations,
          verificationResults: [],
          agentMessages: [],
        } as any,
        { recursion_limit: Math.max(24, goal.maxIterations * 6 + 10) },
      )) as any;

      const escalated = finalState.loopOutcome === "escalated";
      const iterationCount = Number(finalState.iteration ?? 0);
      let outcome: LoopRunResult["outcome"] = escalated
        ? "escalated"
        : "passed";

      let hitl: HITLRequest | undefined;
      if (outcome === "escalated" && hitlEnabled) {
        outcome = "hitl_paused";
        hitl = hitlStore.create({
          threadId,
          traceId: trace.traceId,
          reason: `Verification failed after ${iterationCount} iteration(s)`,
          pendingAction: "create_pr",
          options: ["approve", "reject", "modify"],
        });
      }

      const decision: IterationRecord["decision"] =
        outcome === "passed" ? "pass" : outcome === "hitl_paused" ? "hitl" : "escalate";
      traceStore.appendIteration(trace.traceId, {
        index: iterationCount,
        agentOutput: finalState.lastResult?.output ?? "",
        verification: finalState.verificationResults ?? [],
        decision,
      });
      const traceOutcome: TraceOutcome =
        outcome === "passed" ? "passed" : outcome === "hitl_paused" ? "hitl_paused" : "escalated";
      traceStore.finalize(trace.traceId, traceOutcome);

      const next: LoopState = {
        threadId,
        goal,
        iteration: iterationCount,
        done: outcome === "passed" ? ["task"] : [],
        next: outcome === "passed" ? [] : ["resolve failures"],
        tried: [],
        lastError: escalated ? finalState.error : undefined,
        hitl: hitl
          ? {
              requestId: hitl.requestId,
              reason: hitl.reason,
              pendingAction: hitl.pendingAction,
            }
          : undefined,
        traceId: trace.traceId,
        updatedAt: new Date().toISOString(),
      };
      stateStore.save(next);

      const reply =
        outcome === "passed"
          ? `✅ Loop passed in ${iterationCount} iteration(s).`
          : outcome === "hitl_paused"
            ? `⏸️ Hit the verification ceiling after ${iterationCount} iteration(s); approval requested (${hitl!.requestId}).`
            : `⚠️ Escalated after ${iterationCount} iteration(s): ${finalState.error ?? ""}`;

      return { reply, outcome, traceId: trace.traceId, iterations: iterationCount, hitl };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      traceStore.finalize(trace.traceId, "error");
      return {
        reply: `Error: ${msg}`,
        outcome: "error",
        traceId: trace.traceId,
        iterations: 0,
      };
    }
  }

  return { run, hitlStore, stateStore, traceStore };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/loop/__tests__/runner.integration.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/loop/runner.ts src/loop/__tests__/runner.integration.test.ts
git commit -m "feat(loop): add LoopRunner composing verify->fix->escalate with state, traces, HITL"
```

---

## Task 9: Wire `runCodeagentTurn` + HTTP HITL routes

**Files:**
- Modify: `src/server.ts` (`runCodeagentTurn` delegation)
- Modify: `src/webapp.ts` (two routes)
- Test: `src/loop/__tests__/server-wiring.test.ts`

**Interfaces:**
- Consumes: `createLoopRunner` from `./loop/runner`. Exports a module-level runner singleton so the webapp routes can reach its `hitlStore`.
- Produces: `runCodeagentTurn` delegates to the loop when `LOOP_ENABLED=true` (same return type: `Promise<string>`). New exports: `getLoopRunner()` from `server.ts`; `GET /loop/:threadId/status` and `POST /loop/:threadId/resume` from `webapp.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// src/loop/__tests__/server-wiring.test.ts
import { test, expect } from "bun:test";

test("runCodeagentTurn uses the loop when LOOP_ENABLED and falls back otherwise", async () => {
  // Legacy path: flag off -> returns harness reply (no loop).
  const orig = process.env.LOOP_ENABLED;
  try {
    delete process.env.LOOP_ENABLED;
    const { runCodeagentTurn } = await import("../../server");
    // Without a real harness this returns an error string, but must NOT throw
    // and must not touch loop state.
    const out = await runCodeagentTurn("hi", "legacy-thread");
    expect(typeof out).toBe("string");
  } finally {
    if (orig !== undefined) process.env.LOOP_ENABLED = orig;
  }
});

test("getLoopRunner is available for the HTTP routes", async () => {
  const mod = await import("../../server");
  expect(typeof mod.getLoopRunner).toBe("function");
  const runner = mod.getLoopRunner();
  expect(typeof runner.run).toBe("function");
  expect(typeof runner.hitlStore.resolve).toBe("function");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/loop/__tests__/server-wiring.test.ts`
Expected: FAIL — `getLoopRunner` is not exported.

- [ ] **Step 3a: Delegate in `runCodeagentTurn`**

In `src/server.ts`, add the import and a module-level runner, then branch inside `runCodeagentTurn`. Add near the top imports:

```ts
import { createLoopRunner, type LoopRunner } from "./loop/runner";

let loopRunnerSingleton: ReturnType<typeof createLoopRunner> | undefined;

/** Lazily create (or return) the shared loop runner used by transports. */
export function getLoopRunner() {
  if (!loopRunnerSingleton) loopRunnerSingleton = createLoopRunner();
  return loopRunnerSingleton;
}
```

Then, as the first line inside `runCodeagentTurn`'s `try` block (before `const harness = await getAgentHarness();`), add:

```ts
  if (process.env.LOOP_ENABLED === "true") {
    const runner = getLoopRunner();
    const res = await runner.run({
      input: userText,
      threadId: threadId ?? "default-session",
      userId,
      transport,
    });
    const max = 8190;
    const reply = res.reply;
    return reply.length > max ? `${reply.slice(0, max)}…` : reply;
  }
```

- [ ] **Step 3b: Add HTTP HITL routes in `webapp.ts`**

In `src/webapp.ts`, import the runner and add two routes near the other `app.*` route registrations (the file already uses Hono routing):

```ts
import { getLoopRunner } from "./server";

// GET /loop/:threadId/status — pending HITL request (if any) + last loop state
app.get("/loop/:threadId/status", (c) => {
  const threadId = c.req.param("threadId");
  const runner = getLoopRunner();
  const hitl = runner.hitlStore.getByThread(threadId);
  return c.json({ threadId, pendingHITL: hitl ?? null });
});

// POST /loop/:threadId/resume — resolve a pending HITL request
app.post("/loop/:threadId/resume", async (c) => {
  const threadId = c.req.param("threadId");
  const body = (await c.req.json().catch(() => ({}))) as {
    requestId?: string;
    decision?: "approve" | "reject" | "modify";
    note?: string;
  };
  const runner = getLoopRunner();
  const req = body.requestId
    ? runner.hitlStore.get(body.requestId)
    : runner.hitlStore.getByThread(threadId);
  if (!req) return c.json({ error: "no pending HITL request" }, 404);
  if (!body.decision) return c.json({ error: "decision required" }, 400);
  const resolved = runner.hitlStore.resolve(req.requestId, body.decision, body.note);
  return c.json({ threadId, resolved });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/loop/__tests__/server-wiring.test.ts`
Expected: PASS (2 tests). Also: `bun test src/__tests__/server.test.ts src/__tests__/webapp.test.ts` — no *new* failures.

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/server.ts src/webapp.ts src/loop/__tests__/server-wiring.test.ts
git commit -m "feat(loop): wire runCodeagentTurn to LoopRunner (LOOP_ENABLED) + HTTP HITL routes"
```

---

## Task 10: Telegram HITL inline keyboard

**Files:**
- Modify: `src/utils/telegram.ts` (add `buildHitlKeyboard` + approval sender helper)
- Modify: `src/index.ts` (handle the button callback)
- Test: `tests/utils/telegram.test.ts` (append) — or `src/utils/__tests__/telegram.test.ts` if that is the convention; follow the existing file.

**Interfaces:**
- Produces: `buildHitlKeyboard(requestId: string)` returning a `grammy`-compatible `InlineKeyboardMarkup` with Approve/Reject/Modify buttons whose `callback_data` encodes `loop:hitl:<requestId>:<decision>`. `src/index.ts`'s callback query handler recognizes that prefix and resolves via `getLoopRunner().hitlStore`.

- [ ] **Step 1: Write the failing test**

```ts
// appended to tests/utils/telegram.test.ts (or src/utils/__tests__/telegram.test.ts)
import { test, expect } from "bun:test";
import { buildHitlKeyboard } from "../../src/utils/telegram"; // adjust path to existing convention

test("buildHitlKeyboard emits approve/reject/modify with encoded callbacks", () => {
  const kb = buildHitlKeyboard("req-123");
  const buttons = kb.inline_keyboard.flat();
  const datas = buttons.map((b: any) => b.callback_data);
  expect(datas).toContain("loop:hitl:req-123:approve");
  expect(datas).toContain("loop:hitl:req-123:reject");
  expect(datas).toContain("loop:hitl:req-123:modify");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/utils/telegram.test.ts`
Expected: FAIL — `buildHitlKeyboard` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/utils/telegram.ts`, add (match the grammy `InlineKeyboard` API already used in the file — adjust the constructor call to the existing pattern):

```ts
import { InlineKeyboard } from "grammy";

export function buildHitlKeyboard(requestId: string) {
  return new InlineKeyboard()
    .text("✅ Approve", `loop:hitl:${requestId}:approve`)
    .text("❌ Reject", `loop:hitl:${requestId}:reject`)
    .row()
    .text("✏️ Modify", `loop:hitl:${requestId}:modify`);
}

/** Resolve a HITL callback_data string. Returns null if not a HITL callback. */
export function parseHitlCallback(
  data: string,
): { requestId: string; decision: "approve" | "reject" | "modify" } | null {
  const m = data.match(/^loop:hitl:(.+):(approve|reject|modify)$/);
  if (!m) return null;
  return { requestId: m[1], decision: m[2] as "approve" | "reject" | "modify" };
}
```

In `src/index.ts`, inside the existing `bot.callbackQuery(...)` handler (or add one if absent), resolve HITL callbacks:

```ts
import { parseHitlCallback } from "./utils/telegram";
import { getLoopRunner } from "./server";

// within the callback query handler:
const hitl = parseHitlCallback(ctx.callbackQuery.data ?? "");
if (hitl) {
  const resolved = getLoopRunner().hitlStore.resolve(
    hitl.requestId,
    hitl.decision,
  );
  await ctx.answerCallbackQuery({
    text: resolved
      ? `HITL ${hitl.decision} recorded`
      : "HITL request not found",
  });
  return;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/utils/telegram.test.ts`
Expected: PASS (existing + 1 new).

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/utils/telegram.ts src/index.ts tests/utils/telegram.test.ts
git commit -m "feat(loop): Telegram inline HITL keyboard + callback resolution"
```

---

## Definition of Done (Plan 1)

- All 10 tasks implemented TDD; `bun test src/loop/ src/blueprints/__tests__/feedback-loop.test.ts` green; `bun test src/__tests__/server.test.ts src/__tests__/webapp.test.ts` shows no new failures.
- `bunx tsc --noEmit` clean.
- With `LOOP_ENABLED=true` + a fake harness, `runCodeagentTurn` closes a loop (retry→fix→pass or bounded escalate). With the flag unset, behavior is identical to today.
- L1+L2 of the spec are satisfied. L3 (scheduler + patterns) and L4 (self-improvement) are the next plans, built on this `state-store` + `trace-store`.

---

## Notes for the executor

- The two latent issues from the spec are both resolved here: the registry/environment wiring (Task 4) and the genuine infinite-loop bug (Task 6). Task 6 is the highest-risk task — run its test in isolation and watch for recursion-limit errors (that's the bug surfacing).
- If `bun:sqlite` import resolution differs in the test runner, ensure tests run under `bun test` (not node). The project already uses Bun.
- Do not register host-based `registerBuiltinActions()` anywhere in the loop path.
- Keep edits to `compiler.ts` strictly inside `compileWithFeedbackLoop`; do not touch `compile()` (the plain blueprint path) or existing blueprint tests will regress.
