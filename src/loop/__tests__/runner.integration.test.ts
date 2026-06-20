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

test("unattended autonomy is downgraded to assisted when eval gate not passed (HITL path)", async () => {
  const traceStore = createTraceStore(traceDir);
  const runner = createLoopRunner({
    getHarness: fakeHarness,
    buildRegistry: () => flakyRegistry(99, true), // never passes → escalation
    hitlEnabled: true,
    stateStore: createStateStore(stateDir),
    traceStore,
    evalGatePassed: false,
  });
  const res = await runner.run({
    input: "fix",
    threadId: "unattended-no-gate",
    goal: { maxIterations: 1, autonomyLevel: "unattended" },
  });
  // Downgraded to assisted → escalation routes through HITL instead of running unattended.
  expect(res.outcome).toBe("hitl_paused");
  expect(res.hitl?.requestId).toBeTruthy();
  // Trace records the downgrade feedback note.
  const traces = traceStore.queryByThread("unattended-no-gate");
  const serialized = JSON.stringify(traces);
  expect(serialized).toContain("unattended downgraded to assisted");
});

test("unattended autonomy is NOT downgraded when eval gate has passed", async () => {
  const traceStore = createTraceStore(traceDir);
  const runner = createLoopRunner({
    getHarness: fakeHarness,
    buildRegistry: () => flakyRegistry(99, true), // never passes → escalation
    hitlEnabled: false, // unattended runs without HITL gating
    stateStore: createStateStore(stateDir),
    traceStore,
    evalGatePassed: true,
  });
  const res = await runner.run({
    input: "fix",
    threadId: "unattended-gate-passed",
    goal: { maxIterations: 1, autonomyLevel: "unattended" },
  });
  // Gate passed → unattended honored → no HITL pause (HITL disabled), escalates directly.
  expect(res.outcome).toBe("escalated");
  // No downgrade note recorded.
  const traces = traceStore.queryByThread("unattended-gate-passed");
  expect(JSON.stringify(traces)).not.toContain("unattended downgraded to assisted");
});

test("unattended autonomy is honored via getEvalGate() returning true", async () => {
  const traceStore = createTraceStore(traceDir);
  const runner = createLoopRunner({
    getHarness: fakeHarness,
    buildRegistry: () => flakyRegistry(99, true),
    hitlEnabled: true,
    stateStore: createStateStore(stateDir),
    traceStore,
    getEvalGate: async () => true,
  });
  const res = await runner.run({
    input: "fix",
    threadId: "unattended-getgate",
    goal: { maxIterations: 1, autonomyLevel: "unattended" },
  });
  // Gate passed via async getter → unattended honored even with HITL enabled → escalates directly.
  expect(res.outcome).toBe("escalated");
  expect(JSON.stringify(traceStore.queryByThread("unattended-getgate"))).not.toContain(
    "unattended downgraded to assisted",
  );
});
