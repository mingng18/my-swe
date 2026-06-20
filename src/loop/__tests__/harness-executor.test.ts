import { test, expect } from "bun:test";
import { createHarnessAgentExecutor } from "../harness-executor";
import type { AgentHarness } from "../../harness";

test("delegates input to the harness and maps reply->output", async () => {
  const fakeHarness = {
    run: async (input: string) => ({ reply: `echo:${input}` }),
  } as unknown as AgentHarness;
  const exec = createHarnessAgentExecutor(async () => fakeHarness, {
    threadId: "t1",
  });
  const out = await exec.execute("hello", { models: [], tools: [] });
  expect(out.output).toBe("echo:hello");
  expect(out.messages).toEqual([]);
});

test("falls back to error text when reply is empty", async () => {
  const fakeHarness = {
    run: async () => ({ reply: "", error: "boom" }),
  } as unknown as AgentHarness;
  const exec = createHarnessAgentExecutor(async () => fakeHarness);
  const out = await exec.execute("x", { models: [], tools: [] });
  expect(out.output).toBe("boom");
});
