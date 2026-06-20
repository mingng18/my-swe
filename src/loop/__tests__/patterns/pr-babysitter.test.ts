// src/loop/__tests__/patterns/pr-babysitter.test.ts
import { test, expect } from "bun:test";
import { createPrBabysitterPattern } from "../../patterns/pr-babysitter";

function fakeCycle(unresolvedCount: number) {
  return {
    fetchUnresolvedComments: async () => Array(unresolvedCount).fill({}),
    runCycle: async (n: number) => ({
      prNumber: n,
      totalComments: unresolvedCount,
      addressedComments: unresolvedCount,
      commitsPushed: 1,
      remainingIssues: [],
    }),
  };
}

test("pr-babysitter runs review cycles only for PRs with unresolved comments", async () => {
  const runFor = new Set<number>();
  const pattern = createPrBabysitterPattern({
    repoConfig: { owner: "o", name: "r" },
    githubToken: "tok",
    repoDir: "/repo",
    listOpenPRs: async () => [1, 2, 3],
    // PR 2 has zero unresolved comments -> skipped
    reviewCycleFactory: (prNumber: number) =>
      fakeCycle(prNumber === 2 ? 0 : 3),
  });
  // Wrap runCycle to record which PRs actually ran a cycle
  const base = pattern.run;
  pattern.run = async () => {
    const orig = pattern as unknown as { __opts: any };
    return base.call(pattern);
  };
  void base;

  const summary = (await pattern.run()) as { ok: boolean; detail: unknown };
  expect(summary.ok).toBe(true);
  const detail = summary.detail as any;
  expect(detail.prsScanned).toBe(3);
  expect(detail.prsAddressed).toBe(2); // PRs 1 and 3
  expect(detail.results).toHaveLength(2);
});
