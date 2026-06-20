// src/loop/__tests__/scheduler.test.ts
import { test, expect } from "bun:test";
import { LoopScheduler } from "../scheduler";

test("fire runs a registered pattern and returns a summary", async () => {
  const s = new LoopScheduler();
  let calls = 0;
  s.register({
    name: "p1",
    intervalMs: 60_000,
    run: async () => {
      calls += 1;
      return { name: "p1", ok: true, detail: { n: calls }, at: "now" };
    },
  });
  const out = await s.fire("p1");
  expect(out.ok).toBe(true);
  expect((out.detail as any).n).toBe(1);
  expect(s.list().map((p) => p.name)).toEqual(["p1"]);
});

test("fire on unknown pattern returns ok=false with an error", async () => {
  const s = new LoopScheduler();
  const out = await s.fire("nope");
  expect(out.ok).toBe(false);
  expect(out.error).toMatch(/not found/i);
});

test("run errors are caught and reported, not thrown", async () => {
  const s = new LoopScheduler();
  s.register({
    name: "boom",
    intervalMs: 60_000,
    run: async () => {
      throw new Error("kaboom");
    },
  });
  const out = await s.fire("boom");
  expect(out.ok).toBe(false);
  expect(out.error).toBe("kaboom");
});

test("start schedules a timer that fires run; stop clears it", async () => {
  const s = new LoopScheduler();
  let calls = 0;
  s.register({
    name: "tick",
    intervalMs: 20,
    run: async () => {
      calls += 1;
      return { name: "tick", ok: true, detail: null, at: "now" };
    },
  });
  s.start();
  await new Promise((r) => setTimeout(r, 70));
  s.stop();
  const ticked = calls;
  expect(ticked).toBeGreaterThanOrEqual(1);
  // after stop, no more ticks accrue
  await new Promise((r) => setTimeout(r, 70));
  expect(calls).toBe(ticked);
});
