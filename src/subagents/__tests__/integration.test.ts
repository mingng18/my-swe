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
      model,
      subagents: builtInSubagents,
    });

    expect(agent).toBeDefined();
  });

  it("should create agent with async subagents", async () => {
    const modelConfig = loadModelConfig();
    const model = await createChatModel(modelConfig);

    const agent = createDeepAgent({
      model,
      asyncSubagents,
    });

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
      model,
      subagents: allSubagents,
      asyncSubagents,
    });

    expect(agent).toBeDefined();
  });
});
