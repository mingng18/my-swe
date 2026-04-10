import { describe, it, expect } from "bun:test";
import { builtInSubagents } from "../registry";

describe("subagent registry", () => {
  it("should have 3 built-in subagents", () => {
    expect(builtInSubagents.length).toBe(3);
  });

  it("should have explore-agent with correct config", () => {
    const explore = builtInSubagents.find(a => a.name === "explore-agent");
    expect(explore).toBeDefined();
    expect(explore?.description).toContain("read-only");
    expect(explore?.tools).toBeDefined();
    expect(Array.isArray(explore?.tools)).toBe(true);
  });

  it("should have plan-agent with correct config", () => {
    const plan = builtInSubagents.find(a => a.name === "plan-agent");
    expect(plan).toBeDefined();
    expect(plan?.description).toContain("architect");
  });

  it("should have general-purpose with correct config", () => {
    const general = builtInSubagents.find(a => a.name === "general-purpose");
    expect(general).toBeDefined();
    expect(general?.description).toContain("Versatile");
  });

  it("explore-agent should not have commit tools", () => {
    const explore = builtInSubagents.find(a => a.name === "explore-agent")!;
    const toolNames = explore.tools.map(t => t.name);
    expect(toolNames).not.toContain("commit-and-open-pr");
    expect(toolNames).not.toContain("merge-pr");
  });
});
