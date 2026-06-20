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
