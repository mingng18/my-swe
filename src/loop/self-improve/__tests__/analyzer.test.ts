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
