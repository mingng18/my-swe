// src/loop/__tests__/goal.test.ts
import { test, expect } from "bun:test";
import { deriveGoal, type VerifyProfile } from "../goal";

test("deriveGoal applies defaults from env fallbacks", () => {
  const g = deriveGoal("fix the login bug");
  expect(g.objective).toBe("fix the login bug");
  expect(g.maxIterations).toBe(3); // LOOP_MAX_ITERATIONS default
  expect(g.autonomyLevel).toBe("assisted"); // default
  expect(g.verifyProfile).toBe("tests+lint"); // default
  expect(g.acceptanceCriteria).toContain("tests pass");
  expect(g.acceptanceCriteria).toContain("lint clean");
  expect(g.acceptanceCriteria).not.toContain("typecheck clean");
});

test("deriveGoal maps verifyProfile to acceptanceCriteria and honors opts", () => {
  const g = deriveGoal("t", {
    maxIterations: 5,
    verifyProfile: "tests+lint+typecheck" as VerifyProfile,
    autonomyLevel: "unattended",
  });
  expect(g.maxIterations).toBe(5);
  expect(g.autonomyLevel).toBe("unattended");
  expect(g.acceptanceCriteria).toEqual([
    "tests pass",
    "lint clean",
    "typecheck clean",
  ]);
});
