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
