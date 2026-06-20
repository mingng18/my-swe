// src/loop/__tests__/patterns/ci-sweeper.test.ts
import { test, expect } from "bun:test";
import { createCiSweeperPattern } from "../../patterns/ci-sweeper";

test("ci-sweeper derives a goal per failed run and invokes the loop", async () => {
  const invoked: string[] = [];
  const pattern = createCiSweeperPattern({
    fetchFailedRuns: async () => [
      { id: "run-1", description: "build failed on bun test" },
    ],
    runLoop: async ({ input, threadId }) => {
      invoked.push(`${threadId}:${input.slice(0, 12)}`);
      return { outcome: "passed", reply: "fixed" };
    },
  });
  const summary = (await pattern.run()) as { ok: boolean; detail: unknown };
  expect(summary.ok).toBe(true);
  expect(invoked).toHaveLength(1);
  expect(invoked[0]).toContain("ci-sweeper");
  expect(summary.detail).toMatchObject({ runsScanned: 1, runsHandled: 1 });
});

test("ci-sweeper invokes the loop once per failed run when multiple are fetched", async () => {
  const invoked: { threadId: string; input: string }[] = [];
  const fakeRuns = [
    { id: "run-A", description: "bun test failed", repo: "o/r" },
    { id: "run-B", description: "tsc errored", repo: "o/r" },
  ];
  const pattern = createCiSweeperPattern({
    fetchFailedRuns: async () => fakeRuns,
    runLoop: async ({ input, threadId }) => {
      invoked.push({ threadId, input });
      return { outcome: "passed", reply: "fixed" };
    },
  });
  const summary = (await pattern.run()) as { ok: boolean; detail: unknown };

  expect(summary.ok).toBe(true);
  expect(invoked).toHaveLength(2);
  expect(invoked[0].threadId).toBe("ci-sweeper-run-A");
  expect(invoked[1].threadId).toBe("ci-sweeper-run-B");
  expect(invoked.map((x) => x.threadId)).toEqual([
    "ci-sweeper-run-A",
    "ci-sweeper-run-B",
  ]);
  expect(summary.detail).toMatchObject({ runsScanned: 2, runsHandled: 2 });
});

test("ci-sweeper with no failed runs handles empty", async () => {
  const pattern = createCiSweeperPattern({
    fetchFailedRuns: async () => [],
    runLoop: async () => ({ outcome: "passed", reply: "" }),
  });
  const summary = (await pattern.run()) as { ok: boolean; detail: unknown };
  expect(summary.ok).toBe(true);
  expect((summary.detail as any).runsScanned).toBe(0);
});
