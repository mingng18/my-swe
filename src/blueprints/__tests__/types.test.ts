// src/blueprints/__tests__/types.test.ts

import { describe, it, expect } from "bun:test";
import type {
  Blueprint,
  AgentState,
  DeterministicState,
  TerminalState,
  AgentConfig,
  BlueprintSelection,
  BlueprintState,
  ActionResult,
  DeterministicAction,
} from "../types";

describe("Blueprint Types", () => {
  describe("Blueprint", () => {
    it("should accept valid blueprint structure", () => {
      const blueprint: Blueprint = {
        id: "test-blueprint",
        name: "Test Blueprint",
        description: "A test blueprint",
        triggerKeywords: ["test"],
        priority: 100,
        initialState: "start",
        states: {
          start: { type: "terminal" },
        },
      };

      expect(blueprint.id).toBe("test-blueprint");
      expect(blueprint.initialState).toBe("start");
    });

    it("should support agent states with inline config", () => {
      const agentState: AgentState = {
        type: "agent",
        config: {
          models: ["haiku", "sonnet"],
          tools: ["read", "write"],
          systemPrompt: "You are a helpful agent",
        },
        next: ["next-state"],
      };

      expect(agentState.type).toBe("agent");
      expect(agentState.config.models).toHaveLength(2);
      expect(agentState.config.tools).toContain("read");
    });

    it("should support deterministic states with conditional transitions", () => {
      const detState: DeterministicState = {
        type: "deterministic",
        action: "run_tests",
        on: {
          pass: ["create_pr"],
          fail: ["fix_tests"],
        },
      };

      expect(detState.type).toBe("deterministic");
      expect(detState.on?.pass).toContain("create_pr");
      expect(detState.on?.fail).toContain("fix_tests");
    });

    it("should support terminal states", () => {
      const terminalState: TerminalState = {
        type: "terminal",
      };

      expect(terminalState.type).toBe("terminal");
    });
  });

  describe("BlueprintSelection", () => {
    it("should contain blueprint and metadata", () => {
      const selection: BlueprintSelection = {
        blueprint: {
          id: "test",
          name: "Test",
          description: "Test",
          triggerKeywords: [],
          priority: 0,
          initialState: "start",
          states: { start: { type: "terminal" } },
        },
        confidence: 0.8,
        matchedKeywords: ["test"],
      };

      expect(selection.confidence).toBe(0.8);
      expect(selection.matchedKeywords).toEqual(["test"]);
    });
  });

  describe("BlueprintState", () => {
    it("should hold execution state", () => {
      const state: BlueprintState = {
        input: "fix the bug",
        currentState: "implement",
        lastResult: { success: true, output: "Done" },
      };

      expect(state.input).toBe("fix the bug");
      expect(state.currentState).toBe("implement");
      expect(state.lastResult?.success).toBe(true);
    });
  });

  describe("ActionResult", () => {
    it("should support success and failure cases", () => {
      const success: ActionResult = { success: true, output: "Passed" };
      const failure: ActionResult = { success: false, error: "Failed" };

      expect(success.success).toBe(true);
      expect(failure.success).toBe(false);
      expect(failure.error).toBe("Failed");
    });
  });
});
