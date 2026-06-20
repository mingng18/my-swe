// src/blueprints/__tests__/feedback-loop.test.ts
import { test, expect } from "bun:test";
import { BlueprintCompiler, type AgentExecutor } from "../compiler";
import { ActionRegistry } from "../actions";
import type { GoalSpec } from "../../loop/goal";

function registryWith(passTests: () => boolean) {
  const reg = new ActionRegistry();
  reg.register({
    name: "run_tests",
    description: "",
    execute: async () =>
      passTests()
        ? { success: true, output: "ok" }
        : { success: false, output: "tests failed" },
  });
  reg.register({
    name: "run_linters",
    description: "",
    execute: async () => ({ success: true, output: "lint ok" }),
  });
  reg.register({
    name: "create_pr",
    description: "",
    execute: async () => ({ success: true, output: "pr created" }),
  });
  return reg;
}

const baseGoal: GoalSpec = {
  objective: "fix",
  acceptanceCriteria: ["tests pass"],
  maxIterations: 2,
  autonomyLevel: "assisted",
  verifyProfile: "tests",
};

test("loop terminates at escalate (no infinite loop) and increments iteration", async () => {
  const reg = registryWith(() => false); // tests never pass
  const calls: string[] = [];
  const exec: AgentExecutor = {
    execute: async (input) => {
      calls.push(input);
      return { output: "attempt", messages: [] };
    },
  };
  const graph = new BlueprintCompiler(reg, exec).compileWithFeedbackLoop(2);

  const result = (await graph.invoke(
    {
      input: "fix the bug",
      currentState: "agent",
      goal: baseGoal,
      iteration: 0,
      maxIterations: 2,
      verificationResults: [],
      agentMessages: [],
    } as any,
    { recursion_limit: 50 } as any,
  )) as any;

  // Did not infinite-loop: reached a terminal within the recursion limit.
  expect(result.loopOutcome).toBe("escalated");
  expect(result.iteration).toBeGreaterThanOrEqual(2);
  // Escalate must NOT have auto-created a PR (create_pr only runs on pass).
  expect(result.lastResult?.success).toBe(false);
});

test("loop injects prior-failure feedback into the retry input", async () => {
  const reg = registryWith(() => false);
  const calls: string[] = [];
  const exec: AgentExecutor = {
    execute: async (input) => {
      calls.push(input);
      return { output: "attempt", messages: [] };
    },
  };
  const graph = new BlueprintCompiler(reg, exec).compileWithFeedbackLoop(2);
  await graph.invoke(
    {
      input: "fix the bug",
      currentState: "agent",
      goal: baseGoal,
      iteration: 0,
      maxIterations: 2,
      verificationResults: [],
      agentMessages: [],
    } as any,
    { recursion_limit: 50 } as any,
  );
  expect(calls.length).toBe(2);
  expect(calls[1]).toContain("Previous attempt");
  expect(calls[1]).toContain("tests failed");
});

test("loop passes and sets loopOutcome=passed when verify succeeds", async () => {
  let n = 0;
  const reg = registryWith(() => ++n >= 2); // pass on 2nd verify
  const exec: AgentExecutor = {
    execute: async () => ({ output: "attempt", messages: [] }),
  };
  const graph = new BlueprintCompiler(reg, exec).compileWithFeedbackLoop(2);
  const result = (await graph.invoke(
    {
      input: "fix",
      currentState: "agent",
      goal: baseGoal,
      iteration: 0,
      maxIterations: 2,
      verificationResults: [],
      agentMessages: [],
    } as any,
    { recursion_limit: 50 } as any,
  )) as any;
  expect(result.loopOutcome).toBe("passed");
});
