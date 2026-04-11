// src/blueprints/__tests__/compiler.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { BlueprintCompiler } from "../compiler";
import { ActionRegistry } from "../actions";
import type { Blueprint } from "../types";

describe("BlueprintCompiler", () => {
  let compiler: BlueprintCompiler;
  let actionRegistry: ActionRegistry;

  beforeEach(() => {
    actionRegistry = new ActionRegistry();
    actionRegistry.register({ name: "test_action", description: "Test", execute: async () => ({ success: true, output: "OK" }) });
    compiler = new BlueprintCompiler(actionRegistry);
  });

  it("should compile simple terminal blueprint", () => {
    const blueprint: Blueprint = { id: "simple", name: "Simple", description: "Simple", triggerKeywords: [], priority: 0, initialState: "start", states: { start: { type: "terminal" } } };
    const graph = compiler.compile(blueprint);
    expect(graph).toBeDefined();
  });

  it("should compile blueprint with agent states", () => {
    const blueprint: Blueprint = { id: "agent-test", name: "Agent Test", description: "Test", triggerKeywords: [], priority: 0, initialState: "start", states: { start: { type: "agent", config: { models: ["haiku"], tools: ["read"] }, next: ["end"] }, end: { type: "terminal" } } };
    const graph = compiler.compile(blueprint);
    expect(graph).toBeDefined();
  });
});
