import { describe, it, expect } from "bun:test";
import { builtInSubagents } from "../registry";

describe("subagent registry", () => {
  it("should have 11 built-in subagents", () => {
    expect(builtInSubagents.length).toBe(11);
  });

  it("should have explore-agent with correct config", () => {
    const explore = builtInSubagents.find((a) => a.name === "explore-agent");
    expect(explore).toBeDefined();
    expect(explore?.description).toContain("read-only");
    expect(explore?.tools).toBeDefined();
    expect(Array.isArray(explore?.tools)).toBe(true);
  });

  it("should have plan-agent with correct config", () => {
    const plan = builtInSubagents.find((a) => a.name === "plan-agent");
    expect(plan).toBeDefined();
    expect(plan?.description).toContain("architect");
  });

  it("should have general-purpose with correct config", () => {
    const general = builtInSubagents.find((a) => a.name === "general-purpose");
    expect(general).toBeDefined();
    expect(general?.description).toContain("Versatile");
  });

  it("explore-agent should not have commit tools", () => {
    const explore = builtInSubagents.find((a) => a.name === "explore-agent")!;
    const toolNames = explore.tools?.map((t) => t.name) ?? [];
    expect(toolNames).not.toContain("commit-and-open-pr");
    expect(toolNames).not.toContain("merge-pr");
  });

  it("should have typescript-reviewer with correct config", () => {
    const tsReviewer = builtInSubagents.find((a) => a.name === "typescript-reviewer");
    expect(tsReviewer).toBeDefined();
    expect(tsReviewer?.description).toContain("TypeScript");
    expect(tsReviewer?.description).toContain("type safety");
  });

  it("should have rust-reviewer with correct config", () => {
    const rustReviewer = builtInSubagents.find((a) => a.name === "rust-reviewer");
    expect(rustReviewer).toBeDefined();
    expect(rustReviewer?.description).toContain("Rust");
    expect(rustReviewer?.description).toContain("ownership");
  });

  it("should have java-reviewer with correct config", () => {
    const javaReviewer = builtInSubagents.find((a) => a.name === "java-reviewer");
    expect(javaReviewer).toBeDefined();
    expect(javaReviewer?.description).toContain("Java");
    expect(javaReviewer?.description).toContain("JVM");
  });
});
