// src/loop/__tests__/patterns/daily-triage.test.ts
import { test, expect } from "bun:test";
import { createDailyTriagePattern } from "../../patterns/daily-triage";

test("daily-triage invokes the loop once per new issue", async () => {
  const invoked: string[] = [];
  const pattern = createDailyTriagePattern({
    fetchNewIssues: async () => [
      { number: 11, title: "bug: crash on start", body: "steps…" },
      { number: 12, title: "feat: add export" },
    ],
    runLoop: async ({ input, threadId }) => {
      invoked.push(`${threadId}|${input.length > 0}`);
      return { outcome: "escalated", reply: "triaged" };
    },
  });
  const summary = (await pattern.run()) as { ok: boolean; detail: unknown };
  expect(summary.ok).toBe(true);
  expect(invoked).toHaveLength(2);
  expect((summary.detail as any).issuesTriaged).toBe(2);
});
