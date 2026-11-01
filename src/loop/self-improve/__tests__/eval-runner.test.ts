// src/loop/self-improve/__tests__/eval-runner.test.ts
import { test, expect } from "bun:test";
import { createEvalRunner, loadEvalCasesFromEnv } from "../eval-runner";
type EvalCase = any;
interface EvalReport {
  totalCases: number;
  passed: number;
  failed: number;
  avgDurationMs: number;
  results: any[];
  timestamp: string;
}

// Build a fake report without running a real eval. Only the aggregate counts
// matter for pass-rate computation.
function fakeReport(totalCases: number, passed: number): EvalReport {
  return {
    totalCases,
    passed,
    failed: totalCases - passed,
    avgDurationMs: 0,
    results: [],
    timestamp: "1970-01-01T00:00:00.000Z",
  };
}

test("returns pass-rate as passed/totalCases from runSuite (3/4 = 0.75)", async () => {
  const runSuite = async () => fakeReport(4, 3);
  const runner = createEvalRunner({ runSuite });
  const rate = await runner({} as any); // delta is opaque to the runner
  expect(rate).toBe(0.75);
});

test("returns 0 when runSuite reports zero cases", async () => {
  const runSuite = async () => fakeReport(0, 0);
  const runner = createEvalRunner({ runSuite });
  const rate = await runner({} as any);
  expect(rate).toBe(0);
});

test("returns 1 when every case passes", async () => {
  const runSuite = async () => fakeReport(5, 5);
  const runner = createEvalRunner({ runSuite });
  const rate = await runner({} as any);
  expect(rate).toBe(1);
});

// ---- loadEvalCasesFromEnv -------------------------------------------------

const sampleCases: EvalCase[] = [
  { id: "c1", repo: "o/r", issueNumber: 1, description: "d" },
];

test("loadEvalCasesFromEnv: unset/empty -> null (use conservative default)", () => {
  expect(loadEvalCasesFromEnv(undefined)).toBeNull();
  expect(loadEvalCasesFromEnv("")).toBeNull();
  expect(loadEvalCasesFromEnv("   ")).toBeNull();
});

test("loadEvalCasesFromEnv: inline JSON array -> parsed cases", () => {
  const got = loadEvalCasesFromEnv(JSON.stringify(sampleCases));
  expect(got).toEqual(sampleCases);
});

test("loadEvalCasesFromEnv: file path -> cases read via injected readFile", () => {
  const readFile = (_p: string) => JSON.stringify(sampleCases);
  const got = loadEvalCasesFromEnv("/etc/some/cases.json", readFile);
  expect(got).toEqual(sampleCases);
});

test("loadEvalCasesFromEnv: malformed/unreadable -> null (safe fallback, no throw)", () => {
  expect(loadEvalCasesFromEnv("not-json-not-a-path", () => {
    throw new Error("ENOENT");
  })).toBeNull();
});
