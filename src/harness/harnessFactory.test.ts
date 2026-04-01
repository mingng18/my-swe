import { describe, expect, test } from "bun:test";

describe("harness factory", () => {
  test("returns a harness for deepagents provider", async () => {
    process.env.AGENT_PROVIDER = "deepagents";
    const { getAgentHarness } = await import("./index");
    const harness = await getAgentHarness(process.cwd());

    expect(typeof harness.invoke).toBe("function");
    expect(typeof harness.run).toBe("function");
    expect(typeof harness.stream).toBe("function");
    expect(typeof harness.getState).toBe("function");
  });
});

