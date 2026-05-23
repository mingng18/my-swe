import { describe, it, expect } from "bun:test";
import { createDeepAgent } from "deepagents";
import { createChatModel } from "../../utils/model-factory";
import { loadModelConfig } from "../../utils/config";
import { builtInSubagents } from "../registry";
import { loadRepoAgents, mergeSubagents } from "../agentsLoader";
import { asyncSubagents } from "../async";

describe("subagents integration", () => {
  it("should create agent with built-in subagents", async () => {
    const modelConfig = loadModelConfig();
    const model = await createChatModel(modelConfig);

    const agent = createDeepAgent({
      model: model as any,
      subagents: builtInSubagents,
    });

    expect(agent).toBeDefined();
  });

  it("should have exactly 11 built-in subagents", () => {
    expect(builtInSubagents.length).toBe(11);
    const subagentNames = builtInSubagents.map((agent) => agent.name);
    expect(subagentNames).toEqual([
      "explore-agent",
      "plan-agent",
      "general-purpose",
      "code-reviewer",
      "database-reviewer",
      "security-reviewer",
      "go-reviewer",
      "python-reviewer",
      "typescript-reviewer",
      "rust-reviewer",
      "java-reviewer",
    ]);
  });

  it("should create agent with async subagents", async () => {
    const modelConfig = loadModelConfig();
    const model = await createChatModel(modelConfig);

    const agent = createDeepAgent({
      model: model as any,
      asyncSubagents,
    } as any);

    expect(agent).toBeDefined();
  });

  it("should merge built-in and repo agents", async () => {
    const repoAgents = await loadRepoAgents(".agents/agents");
    const merged = mergeSubagents(builtInSubagents, repoAgents);

    expect(merged.length).toBeGreaterThanOrEqual(builtInSubagents.length);
  });

  it("should create agent with all subagent types", async () => {
    const modelConfig = loadModelConfig();
    const model = await createChatModel(modelConfig);
    const repoAgents = await loadRepoAgents(".agents/agents");
    const allSubagents = mergeSubagents(builtInSubagents, repoAgents);

    const agent = createDeepAgent({
      model: model as any,
      subagents: allSubagents,
      asyncSubagents,
    } as any);

    expect(agent).toBeDefined();
  });
});
