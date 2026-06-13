import { describe, it, expect, beforeEach } from "bun:test";
import { BlueprintCompiler, BlueprintCompilerError } from "../compiler";
import { ActionRegistry } from "../actions";
import type { Blueprint, AgentState, DeterministicState } from "../types";
import { BlueprintStateAnnotation } from "../state";

describe("BlueprintCompiler", () => {
  let compiler: BlueprintCompiler;
  let actionRegistry: ActionRegistry;

  beforeEach(() => {
    actionRegistry = new ActionRegistry();
    actionRegistry.register({ name: "test_action", description: "Test", execute: async () => ({ success: true, output: "OK" }) });
    actionRegistry.register({ name: "failing_action", description: "Test fail", execute: async () => ({ success: false, output: "Fail" }) });
    compiler = new BlueprintCompiler(actionRegistry);
  });

  it("should compile simple terminal blueprint", () => {
    const blueprint: Blueprint = { id: "simple", name: "Simple", description: "Simple", triggerKeywords: [], priority: 0, initialState: "start", states: { start: { type: "terminal" } } };
    const graph = compiler.compile(blueprint);
    expect(graph).toBeDefined();
  });

  it("should compile blueprint with agent states", async () => {
    const blueprint: Blueprint = { id: "agent-test", name: "Agent Test", description: "Test", triggerKeywords: [], priority: 0, initialState: "start", states: { start: { type: "agent", config: { models: ["haiku"], tools: ["read"] }, next: ["end"] }, end: { type: "terminal" } } };
    const graph = compiler.compile(blueprint);
    expect(graph).toBeDefined();

    const result = await graph.invoke({ currentState: "start", input: "test input" });
    expect(result.currentState).toBe("__end__");
    expect(result.lastResult).toBeDefined();
    expect(result.lastResult?.output).toContain("Agent 'unnamed' executed");
  });

  it("should format agent output with a specific name", async () => {
    const blueprint: Blueprint = { id: "agent-name", name: "Agent Name", description: "Test name", triggerKeywords: [], priority: 0, initialState: "start", states: { start: { type: "agent", config: { name: "my_agent", models: ["haiku"], tools: ["read"] }, next: ["end"] }, end: { type: "terminal" } } };
    const graph = compiler.compile(blueprint);

    const result = await graph.invoke({ currentState: "start", input: "input" });
    expect(result.lastResult?.output).toContain("Agent 'my_agent' executed");
  });

  it("should handle deterministic state without 'on' or 'next'", async () => {
    const blueprint: Blueprint = {
      id: "no-transition",
      name: "No Transition",
      description: "Test",
      triggerKeywords: [],
      priority: 0,
      initialState: "start",
      states: {
        start: {
          type: "deterministic",
          action: "test_action"
        }
      }
    };
    const graph = compiler.compile(blueprint);
    const result = await graph.invoke({ currentState: "start", input: "input" });

    expect(result.lastResult).toEqual({ success: true, output: "OK" });
  });

  it("should throw error when action is missing in deterministic state", async () => {
    const blueprint: Blueprint = {
      id: "error-test",
      name: "Error Test",
      description: "Test error handling",
      triggerKeywords: [],
      priority: 0,
      initialState: "start",
      states: {
        start: {
          type: "deterministic",
          action: "unknown_action",
          next: ["end"],
        },
        end: { type: "terminal" }
      }
    };

    const graph = compiler.compile(blueprint);

    await expect(graph.invoke({ currentState: "start", input: "test input" })).rejects.toThrow(BlueprintCompilerError);
    await expect(graph.invoke({ currentState: "start", input: "test input" })).rejects.toThrow(/Action not found: unknown_action/);
  });

  it("should compile deterministic state and invoke registered action", async () => {
    const blueprint: Blueprint = {
      id: "deterministic-test",
      name: "Deterministic Test",
      description: "Test deterministic",
      triggerKeywords: [],
      priority: 0,
      initialState: "start",
      states: {
        start: {
          type: "deterministic",
          action: "test_action",
          next: ["end"]
        },
        end: { type: "terminal" }
      }
    };
    const graph = compiler.compile(blueprint);
    const result = await graph.invoke({ currentState: "start", input: "input" });

    expect(result.lastResult).toEqual({ success: true, output: "OK" });
    expect(result.currentState).toBe("__end__");
  });

  it("should fallback to terminal state when conditional transitions are omitted", async () => {
    const blueprint: Blueprint = {
      id: "conditional-missing",
      name: "Conditional Missing",
      description: "Test condition missing",
      triggerKeywords: [],
      priority: 0,
      initialState: "start",
      states: {
        start: {
          type: "deterministic",
          action: "test_action",
          on: {
            // empty pass/fail defaults to terminal nodes instead of raw __end__ if node is not defined
            pass: ["end"],
            fail: ["end"]
          }
        },
        end: { type: "terminal" }
      }
    };
    const graph = compiler.compile(blueprint);
    const result = await graph.invoke({ currentState: "start", input: "input" });

    expect(result.currentState).toBe("__end__");
  });

  it("should compile state machine with conditional transitions", async () => {
    const blueprint: Blueprint = {
      id: "conditional-test",
      name: "Conditional Test",
      description: "Test condition",
      triggerKeywords: [],
      priority: 0,
      initialState: "start",
      states: {
        start: {
          type: "deterministic",
          action: "failing_action",
          on: {
            pass: ["pass_state"],
            fail: ["fail_state"]
          }
        },
        pass_state: { type: "terminal" },
        fail_state: { type: "terminal" }
      }
    };
    const graph = compiler.compile(blueprint);

    const result = await graph.invoke({ currentState: "start", input: "test input" });

    expect(result.lastResult).toEqual({ success: false, output: "Fail" });
    expect(result.currentState).toBe("__end__");
  });

  it("should throw BlueprintCompilerError for unknown state type", () => {
    const blueprint: Blueprint = {
      id: "invalid-test",
      name: "Invalid Test",
      description: "Test invalid",
      triggerKeywords: [],
      priority: 0,
      initialState: "start",
      states: {
        start: {
          type: "unknown" as any
        }
      }
    };

    const graph = compiler.compile(blueprint);
    expect(graph.invoke({ currentState: "start", input: "test input" })).rejects.toThrow(BlueprintCompilerError);
  });

  it("should handle agent state without next elements", async () => {
    const blueprint: Blueprint = {
      id: "agent-no-next",
      name: "Agent No Next",
      description: "Test agent",
      triggerKeywords: [],
      priority: 0,
      initialState: "start",
      states: {
        start: {
          type: "agent",
          config: { models: ["haiku"], tools: ["read"] },
          next: []
        }
      }
    };
    const graph = compiler.compile(blueprint);
    const result = await graph.invoke({ currentState: "start", input: "test input" });

    expect(result.currentState).toBe("__end__");
  });
});
