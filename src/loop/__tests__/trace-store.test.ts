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
