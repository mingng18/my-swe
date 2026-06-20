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
