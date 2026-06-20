# Loop Engineering Roadmap — Design Spec

- **Date:** 2026-06-20
- **Status:** Approved (approach, scope, and all three design forks confirmed with user)
- **Owner:** my-swe (Bullhorse)
- **Build scope:** Full LangChain loopcraft ladder (L1→L4), implemented this session
- **Grounding sources:**
  - [LangChain — The Art of Loop Engineering](https://www.langchain.com/blog/the-art-of-loop-engineering)
  - [Addy Osmani — Loop Engineering](https://addyosmani.com/blog/loop-engineering/)
  - [Cobus Greyling — loop-engineering (repo)](https://github.com/cobusgreyling/loop-engineering)
  - Triangulation: [MindStudio](https://www.mindstudio.ai/blog/what-is-loop-engineering-ai-coding-agents), [Lushbinary](https://lushbinary.com/blog/loop-engineering-ai-coding-agents-guide/)
- **Implementation gate:** `bun test` (keep the existing green suite green) + `bunx tsc --noEmit`

---

## 1. Problem & Goal

my-swe is a capable agentic coder, but its production execution path is a **single one-shot agent call**. A large inventory of loop machinery exists — a feedback-loop graph compiler, deterministic verify nodes, an eval harness, a PR-review cycle, execution traces — but **none of it is reachable from the production path**, and the one feedback-loop compiler that would close the loop has two latent bugs that would make it either falsely pass or loop forever.

**Goal:** make my-swe a genuine *loop-engineering system* — one where every task runs inside a bounded, verified, observable, resumable loop that closes its own work (or escalates to a human), where loops can be scheduled to run themselves against events, and where accumulated traces let the system improve its own harness over time.

**Definition of "loop engineering" (synthesized from sources):** designing the *outer* system that prompts an agent on a schedule against a *verifiable goal*, rather than typing each prompt yourself. It is the layer above prompt + context engineering: scheduling, verification, durable memory, escalation, traces, evaluation, and human gates — "a loop is a recursive goal."

---

## 2. The loopcraft ladder (our organizing spine)

We adopt LangChain's 4-rung taxonomy as the roadmap spine, executed integration-first (lower rungs land solidly before upper rungs):

| Rung | Name | What it is | my-swe today |
|------|------|------------|--------------|
| **L1** | Agent loop | The inner perceive-reason-act loop (the harness) | Exists (OpenCode/DeepAgents), but no explicit termination contract or structured trace emission |
| **L2** | Verify / feedback loop | Maker-checker gate + feedback→re-prompt + escalation | Built but **disconnected + buggy**; not in the production path |
| **L3** | Event / scheduled loops | Loops that fire on cron/webhook without a human prompt | `pr-review-cycle` exists standalone; no scheduler |
| **L4** | Hill-climbing self-improvement | An analysis agent rewrites the harness from traces | Absent (traces aren't even persisted queryably) |

---

## 3. Verified current state & core gap

Confirmed by direct code inspection (not summary):

- `runCodeagentTurn(input, threadId?, userId?, transport?)` → `Promise<string>` at **`src/server.ts:18`** is the **sole production entry** for all transports (HTTP `/run`, `/v1/chat/completions`, Telegram, GitHub webhook). It calls `getAgentHarness().run(...)` once and returns a reply string. One-shot.
- `src/server.ts:10` comment: *"The outer StateGraph pipeline has been eliminated — all orchestration … is now handled by … the harness."* The outer graph was deliberately removed, orphaning the loop machinery.
- `src/graph.ts` (LangGraph Cloud export) is single-node: `__start__ → agent → __end__`, where `agent` just calls `runCodeagentTurn`.
- `BlueprintCompiler.compileWithFeedbackLoop(maxRetries)` at **`src/blueprints/compiler.ts:97`** has **zero production call sites** — dead code.
- No HITL / `interrupt()` anywhere in the agent path.

**Latent bugs in the dead feedback loop (must be fixed when we wire it):**

1. **Action-name mismatch → false pass.** The verify node calls `actionReg.get("run_tests")` / `"run_linters"` (`compiler.ts:147,166`), but `verification-actions.ts` registers `verify_tests` / `verify_lint` / `verify_typecheck` / `verify_tests_and_lint` / `create_pr`. Both lookups return `undefined`, `verificationResults` stays `[]`, and `allPassed = [].every(...)` evaluates `true` → the loop would create a PR **without verifying anything**.
2. **Iteration never increments + no feedback injection → infinite loop.** The agent node never bumps `state.iteration`, and the "wrapper" that injects error context into the retry (acknowledged at `compiler.ts:305-307`) does not exist. On failure, `iteration (0) < maxRetries` is always true, so it routes `check_results → agent` forever.

**Core gap, stated sharply:** my-swe is a one-shot agent with a warehouse of disconnected loop parts. Route `runCodeagentTurn` through the feedback loop that already exists — and fix it so it actually verifies, feeds back, and terminates.

---

## 4. Design decisions (resolved forks)

| Fork | Decision | Rationale |
|------|----------|-----------|
| **Loop entry** | **B — `LoopRunner` inside the turn.** Keep `runCodeagentTurn` as the entry signature; when `LOOP_ENABLED`, delegate to a new `LoopRunner` that compiles + invokes the feedback-loop graph. | Surgical; reuses `compiler.ts`; respects the deliberate "outer graph eliminated" decision. HITL via pause-and-resume on persisted state. |
| **Trace store** | **Local SQLite/JSONL** under `WORKSPACE_ROOT/loop-traces/`. JSONL per run + a `bun:sqlite` index for queries. Langfuse remains the human observability view. | Self-contained, zero external deps (Bun ships `bun:sqlite`), queryable for L4. |
| **HITL channel** | **Telegram + HTTP.** Telegram inline approve/reject buttons for humans; `POST /loop/:threadId/resume` + `GET /loop/:threadId/status` for programmatic/CI. | Covers async-mobile and automated flows. |

---

## 5. Architecture

```
HTTP / Telegram / Webhook
        │
        ▼
 runCodeagentTurn(input, threadId, userId, transport)   ← signature UNCHANGED
        │  if LOOP_ENABLED  (else: legacy one-shot, unchanged)
        ▼
 ┌────────────────────────────────────────────────────────────────┐
 │ LoopRunner.run({ goal, threadId, autonomyLevel })              │
 │                                                                 │
 │  1. read STATE (state-store)   ← resume-safe                    │
 │  2. build AgentExecutor = HarnessAgentExecutor(harness)         │
 │  3. graph = compiler.compileWithFeedbackLoop(goal.maxIterations)│
 │  4. open TraceRecord (trace-store)                              │
 │  5. graph.invoke({ input, goal, … }) with bounded recursion     │
 │                                                                 │
 │   ┌──▶ agent ──▶ verify(eval-gate) ──▶ check ─────────────────┐ │
 │   │    ▲ HarnessAgentExecutor       │                  │       │ │
 │   │    │ bumps iteration,            │ pass             │ fail  │ │
 │   │    │ injects error ctx,          │ ▼                 │       │ │
 │   │    │ emits step trace            │ create_pr ─▶ END  │ iter< │ │
 │   │    └─────────────────────────────┘                  │  max? │ │
 │   │                                                  no │ ▼      │ │
 │   │                                          HITL/escalate ─▶ END │ │
 │   └─ each node appends to the TraceRecord ◀────────────────────┘ │
 │                                                                 │
 │  6. on HITL pause → write STATE + emit HITLRequest → return      │
 │     { status: "needs_approval", … }                             │
 │  7. on resume → re-enter graph from persisted state              │
 │  8. write STATE + finalize TraceRecord                          │
 └─────────────────────────────────────────────────────────────────┘
        │
        ▼ pass → create_pr ; escalate → notify + request human
```

**Module map (`src/loop/` — all new, parallel-safe):**

| Module | Rung | Responsibility |
|--------|------|----------------|
| `loop/goal.ts` | L1 | `GoalSpec` type + parser (task + blueprint → goal) |
| `loop/state-store.ts` | L2 | Durable per-thread loop state (read start / write each iter) |
| `loop/trace-store.ts` | L2 | JSONL + SQLite trace store; append + query |
| `loop/harness-executor.ts` | L2 | `AgentExecutor` adapter over the harness; **fixes both latent bugs** (iteration bump + error feedback injection + trace emission) |
| `loop/runner.ts` | L2 | `LoopRunner.run()` — compile + invoke + resume |
| `loop/eval-gate.ts` | L2 | Wrap `src/eval/` EvalHarness as a verify gate |
| `loop/hitl.ts` | L2 | HITL pause/resume + HITLRequest emission |
| `loop/verify-registry.ts` | L2 | Build the `ActionRegistry` with **correct** action names wiring `verification-actions.ts` |
| `loop/scheduler.ts` | L3 | cron/event-driven loop firing |
| `loop/patterns/pr-babysitter.ts` | L3 | Scheduled loop over `pr-review-cycle` |
| `loop/patterns/ci-sweeper.ts` | L3 | Scheduled loop over failed CI |
| `loop/patterns/daily-triage.ts` | L3 | Scheduled loop over new issues |
| `loop/self-improve/analyzer.ts` | L4 | Analyze traces → failure patterns |
| `loop/self-improve/config-rewriter.ts` | L4 | Propose harness-config edits |
| `loop/self-improve/apply.ts` | L4 | Eval-gated + HITL application of rewrites |

---

## 6. Rungs in detail

### L1 — Solidify the agent loop
**Deliverable:** make the termination contract explicit and the inner loop observable. No behavior change yet.
- `loop/goal.ts`: `GoalSpec` (see §8). Derived from the task text + selected blueprint's `maxIterations`/verify profile.
- `harness/agent-factory.ts`: emit a structured `StepRecord` per agent turn to the trace store (the harness already has recursion-limit, loop-detection, budget — bind these to the `GoalSpec` ceiling).
- **Acceptance:** a `GoalSpec` can be parsed from a task; the harness emits one trace step per turn; recursion/budget enforcers read ceilings from the goal when present. Unit-tested.

### L2 — Verify / feedback loop (closes the core gap)
**Deliverable:** `runCodeagentTurn` runs a real, bounded verify→fix→escalate loop.
- `loop/verify-registry.ts`: builds an `ActionRegistry` whose keys **match what the compiler looks up** (`run_tests`, `run_linters`, `create_pr`), each delegating to the correct `verification-actions.ts` creator. This fixes latent bug #1.
- `loop/harness-executor.ts`: implements `AgentExecutor.execute`. On each call it: (a) reads the latest `verificationResults` + `error` from state, (b) if retrying, **prepends a feedback block** ("Previous attempt failed: …") to the input, (c) returns `{output, messages}`. The loop-enabled agent node additionally returns `{iteration: (state.iteration ?? 0) + 1}` on each invocation, so `check_results`'s `iteration < maxRetries` test converges and the loop terminates. This fixes latent bug #2.
- `loop/runner.ts`: reads state, builds executor + registry, calls `compileWithFeedbackLoop(goal.maxIterations)`, invokes with `recursion_limit`, writes state + trace each iteration.
- `loop/eval-gate.ts`: an additional verify step that runs the `EvalHarness` for the thread's case (if one is registered); failure is treated like any other verify failure (feeds back, retries).
- `loop/hitl.ts`: at `escalate` and before risky terminal actions (auto-merge, infra-affecting shell), pause: persist state, emit `HITLRequest`, return `{status:"needs_approval"}`. Resume re-enters the graph from persisted state. **Behavior change:** when `LOOP_HITL_ENABLED` is set, the `escalate` node pauses for HITL *instead of* its current legacy behavior of auto-creating a PR with a ⚠️ warning (`compiler.ts:242-257`); that legacy auto-PR-with-warning path is the fallback when HITL is disabled.
- `runCodeagentTurn` change: `if (LOOP_ENABLED) return loopRunner.run({...}); else <existing one-shot>`.
- **Acceptance:** against a fake harness + a repo with a failing test, `runCodeagentTurn` retries up to `maxIterations`, injects the prior failure into the retry, passes once the fake harness "fixes" it, then `create_pr`; if never fixed, it escalates (does **not** infinite-loop, does **not** falsely pass). Integration-tested end-to-end. Existing one-shot path still works when `LOOP_ENABLED` is unset.

### L3 — Event / scheduled loops
**Deliverable:** a scheduler that fires loop runs from events, with one working pattern.
- `loop/scheduler.ts`: registers cron/event triggers; each trigger derives a `GoalSpec` from an event and calls `LoopRunner.run`. Backed by `node-cron`-style scheduling (use a lightweight in-process scheduler; no external queue required for v1).
- `loop/patterns/pr-babysitter.ts`: on a cron, list open PRs with unresolved review comments and run `pr-review-cycle.ts` (already a multi-round loop) for each — wired onto the scheduler.
- `loop/patterns/ci-sweeper.ts` and `loop/patterns/daily-triage.ts`: same shape, v1 stubs that compile + run with a clear `// TODO: event adapter` so the pattern is real but the event source is pluggable.
- **Acceptance:** registering a cron fires a `LoopRunner.run` at the tick (tested with a fake timer); the PR-babysitter pattern compiles and runs against a fake PR with review comments.

### L4 — Hill-climbing self-improvement
**Deliverable:** an analysis job over traces that proposes eval-gated, human-approved harness-config edits.
- `loop/self-improve/analyzer.ts`: queries the trace store for failed/passed iterations across runs, clusters failure patterns (e.g. "verify_tests fails on import errors 12×"), produces a structured `AnalysisReport`.
- `loop/self-improve/config-rewriter.ts`: turns an `AnalysisReport` into proposed harness-config deltas (prompt addenda, tool/grader tweaks) — a diff, never a blind overwrite.
- `loop/self-improve/apply.ts`: applies a delta **only if** running the eval suite with the delta applied does not regress (and ideally improves) pass-rate, **and** after HITL approval. Records the applied delta as a trace event.
- **Acceptance:** given a seeded trace store + a contrived weak-grader case, the analyzer surfaces the pattern, the rewriter proposes a targeted delta, and `apply` rejects a regressing delta and accepts an improving one (HITL-gated). Unit + integration tested with a frozen eval.

---

## 7. Schemas

```ts
// loop/goal.ts
interface GoalSpec {
  objective: string;
  acceptanceCriteria: string[];      // rubric items the checker grades against
  maxIterations: number;             // hard ceiling on agent retries
  budgetCeiling?: { tokens?: number; cost?: number };
  autonomyLevel: "report" | "assisted" | "unattended";
  verifyProfile: "tests" | "tests+lint" | "tests+lint+typecheck" | "eval";
}

// loop/trace-store.ts
interface TraceRecord {
  traceId: string;                   // run id
  threadId: string;
  goal: GoalSpec;
  startedAt: string; endedAt?: string;
  iterations: IterationRecord[];
  outcome: "passed" | "escalated" | "hitl_paused" | "error" | "running";
}
interface IterationRecord {
  index: number;
  agentSteps: StepRecord[];          // from harness (L1)
  verification: VerificationResult[];// from verify node
  feedbackInjected?: string;
  decision: "retry" | "pass" | "escalate" | "hitl";
}

// loop/state-store.ts  (durable, resume-safe)
interface LoopState {
  threadId: string;
  goal: GoalSpec;
  iteration: number;
  done: string[]; next: string[]; tried: string[];
  lastError?: string;
  hitl?: { requestId: string; reason: string; pendingAction: string };
  traceId: string;
  updatedAt: string;
}

// loop/hitl.ts
interface HITLRequest {
  requestId: string; threadId: string; traceId: string;
  reason: string;                    // why human input is needed
  pendingAction: string;             // e.g. "create_pr", "auto-merge"
  options: ("approve" | "reject" | "modify")[];
}
```

`BlueprintStateAnnotation` (`src/blueprints/state.ts`) is extended with `goal?: GoalSpec`, `traceId?: string`, `autonomyLevel?`, `stateSummary?`, `hitl?` so the loop graph carries loop-level context. (Additive fields; existing blueprint tests unaffected.)

---

## 8. GoalSpec derivation

`loop/goal.ts` exports `deriveGoal(task, blueprint?)`:
- `objective` ← task text.
- `maxIterations` ← blueprint's `BLUEPRINT_MAX_ITERATIONS` (e.g. bug-fix=2, feature=3) or `LOOP_MAX_ITERATIONS` env (default 3).
- `verifyProfile` ← blueprint's verify shape (e.g. `test` blueprint → `tests`; default → `tests+lint`).
- `acceptanceCriteria` ← task-derived ("tests pass", "lint clean", "typecheck clean") + any explicit criteria parsed from the task.
- `autonomyLevel` ← `LOOP_AUTONOMY_LEVEL` env (default `"assisted"`; `"unattended"` requires passing the eval gate).

---

## 9. Integration touchpoints (shared edits — sequence carefully)

| File | Edit | Rung |
|------|------|------|
| `src/server.ts` | `runCodeagentTurn`: `if (LOOP_ENABLED) return loopRunner.run(...)`. One delegation. | L2 |
| `src/blueprints/compiler.ts` | Verify node action lookups + iteration/feedback wiring validated against `HarnessAgentExecutor`; keep public API stable. | L2 |
| `src/blueprints/state.ts` | Additive loop fields on the annotation. | L2 |
| `src/harness/agent-factory.ts` | Emit `StepRecord` to trace store per turn. | L1 |
| `src/webapp.ts` | `POST /loop/:threadId/resume`, `GET /loop/:threadId/status`. | L2 |
| Telegram transport (`src/index.ts` / `src/utils/telegram.ts`) | Inline approve/reject keyboard for HITL. | L2 |
| `src/blueprints/verification-actions.ts` | None (consumed as-is via `verify-registry`). | — |

All substantive new work lives in new files under `src/loop/`; shared edits are thin registrations / 1-line delegations, sequenced at merge time.

---

## 10. Environment variables

```
LOOP_ENABLED=true                  # gate the new path; unset = legacy one-shot
LOOP_MAX_ITERATIONS=3              # default ceiling (overridable per goal/blueprint)
LOOP_AUTONOMY_LEVEL=assisted       # report | assisted | unattended
LOOP_HITL_ENABLED=true             # pause for human approval at escalate / risky
LOOP_STATE_DIR=$WORKSPACE_ROOT/loop-state
LOOP_TRACE_DIR=$WORKSPACE_ROOT/loop-traces
LOOP_EVAL_GATE=true                # gate "done" on the eval harness
LOOP_SCHEDULE_*                    # per-pattern cron expressions (L3)
LOOP_SELF_IMPROVE_ENABLED=false    # L4 off by default; enable explicitly
```

---

## 11. Maturity ladder (autonomy)

Every `LoopRunner.run` declares an `autonomyLevel`. Mapping:

- **report** — loop runs verify-only and reports results; makes no changes / PRs. Safe default for new loop types.
- **assisted** — loop attempts fixes and opens a PR, but **escalates to HITL** before merge/risky actions. Default for `runCodeagentTurn`.
- **unattended** — loop may merge/auto-apply, but **only** if the eval gate passes and `LOOP_AUTONOMY_LEVEL=unattended`. Never the default.

Unattended is **earned** by passing evals, never assumed.

---

## 12. Testing strategy

- **Unit per module** (`src/loop/__tests__/*`): goal derivation, state-store read/write, trace-store append/query, harness-executor (iteration bump + feedback injection), eval-gate pass/fail, HITL request/resume, scheduler tick, analyzer clustering, config-rewriter delta gen, apply accept/reject.
- **Latent-bug regression tests:** (a) verify node actually runs actions and does not falsely pass when tests fail; (b) iteration increments and the loop terminates at `maxIterations` instead of spinning.
- **Integration:** `runCodeagentTurn` with `LOOP_ENABLED` + a fake harness over a temp repo closes the loop end-to-end (retry → fix → pass → PR; and retry → never-fix → escalate). Legacy one-shot still returns a reply when `LOOP_ENABLED` unset.
- **E2E (L3):** a scheduled pattern fires `LoopRunner.run` at a fake tick.
- **Gate:** existing suite stays green (no new failures beyond the documented pre-existing ones) + `bunx tsc --noEmit` clean.

---

## 13. Phasing / build order (within "build all")

Strict order — each rung's tests green before the next begins:

1. **L1:** `goal.ts` + harness `StepRecord` emission. (foundation)
2. **L2 core:** `verify-registry` + `harness-executor` (fixes both latent bugs) + `state-store` + `trace-store`. (closes the loop)
3. **L2 wire:** `runner.ts` + `runCodeagentTurn` delegation + `eval-gate` + `hitl` + webapp/Telegram HITL routes. (production path)
4. **L3:** `scheduler.ts` + `pr-babysitter` (real) + `ci-sweeper`/`daily-triage` (compiling stubs).
5. **L4:** `analyzer` + `config-rewriter` + `apply` (eval-gated, HITL-gated), off by default.

L2 is the load-bearing rung; L3/L4 build on its state + trace stores.

---

## 14. Out of scope / deferred

- Restoring the outer StateGraph as the top-level production path (we chose the LoopRunner-inside-turn approach).
- External message queue / distributed scheduler (v1 is in-process cron).
- Cross-thread trace analytics warehouse / dashboard UI (L4 analyzer reads the local store only).
- Packaging blueprints as a user-facing "loop marketplace" (the loops are runnable; the marketplace UX is a later product decision).
- Auto-applying L4 rewrites without HITL (permanently gated behind approval).
