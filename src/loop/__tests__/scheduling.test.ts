// src/loop/__tests__/scheduling.test.ts
import { test, expect, beforeEach } from "bun:test";
import { registerScheduledPatterns } from "../scheduling";

const KEYS = [
  "LOOP_SCHEDULING_ENABLED",
  "LOOP_SCHEDULE_PR_BABYSITTER_MS",
  "GITHUB_TOKEN",
  "GITHUB_DEFAULT_OWNER",
];
beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
});

test("returns a scheduler with no patterns when disabled", () => {
  const s = registerScheduledPatterns();
  expect(s.list()).toEqual([]);
});

test("registers pr-babysitter when enabled + configured", () => {
  process.env.LOOP_SCHEDULING_ENABLED = "true";
  process.env.GITHUB_TOKEN = "tok";
  process.env.GITHUB_DEFAULT_OWNER = "me";
  process.env.LOOP_REPO = "me/myrepo";
  process.env.LOOP_SCHEDULE_PR_BABYSITTER_MS = "30000";
  const s = registerScheduledPatterns();
  const names = s.list().map((p) => p.name);
  expect(names).toContain("pr-babysitter");
});
