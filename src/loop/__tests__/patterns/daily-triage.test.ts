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

test("daily-triage with an injected fetchNewIssues calls runLoop exactly once per issue, with a distinct threadId per issue", async () => {
  const calls: Array<{ threadId: string; input: string }> = [];
  const fakeIssues = [
    { number: 101, title: "first issue", body: "body-1" },
    { number: 102, title: "second issue" },
  ];
  const pattern = createDailyTriagePattern({
    fetchNewIssues: async () => fakeIssues,
    runLoop: async ({ input, threadId }) => {
      calls.push({ threadId, input });
      return { outcome: "escalated", reply: "ok" };
    },
  });

  const summary = (await pattern.run()) as {
    ok: boolean;
    detail: { issuesTriaged: number };
  };

  // One call per issue, no more, no less.
  expect(calls).toHaveLength(fakeIssues.length);
  expect(summary.ok).toBe(true);
  expect(summary.detail.issuesTriaged).toBe(fakeIssues.length);

  // Each issue got its own threadId and a non-empty triage input.
  const threadIds = calls.map((c) => c.threadId);
  expect(new Set(threadIds).size).toBe(fakeIssues.length);
  expect(threadIds[0]).toBe("daily-triage-issue-101");
  expect(threadIds[1]).toBe("daily-triage-issue-102");
  for (const c of calls) {
    expect(c.input.length).toBeGreaterThan(0);
  }
});

test("daily-triage with no fetchNewIssues and no repoConfig/githubToken returns no issues (no network)", async () => {
  const calls: string[] = [];
  const pattern = createDailyTriagePattern({
    runLoop: async ({ threadId }) => {
      calls.push(threadId);
      return { outcome: "escalated", reply: "ok" };
    },
  });
  const summary = (await pattern.run()) as {
    ok: boolean;
    detail: { issuesTriaged: number };
  };
  expect(summary.ok).toBe(true);
  expect(summary.detail.issuesTriaged).toBe(0);
  expect(calls).toHaveLength(0);
});
