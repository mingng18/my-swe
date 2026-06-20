// src/loop/__tests__/scheduling.integration.test.ts
import { test, expect } from "bun:test";
import { registerScheduledPatterns } from "../scheduling";

test("scheduler fires a pattern end-to-end via fire()", async () => {
  const scheduler = registerScheduledPatterns(); // disabled in test env -> empty
  // Register an ad-hoc pattern to prove the scheduler drives a loop run.
  let ran = 0;
  scheduler.register({
    name: "ad-hoc",
    intervalMs: 60_000,
    run: async () => {
      ran += 1;
      return { name: "ad-hoc", ok: true, detail: { ran }, at: "now" };
    },
  });
  const out = await scheduler.fire("ad-hoc");
  expect(out.ok).toBe(true);
  expect(ran).toBe(1);
});
