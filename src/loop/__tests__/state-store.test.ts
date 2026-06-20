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
