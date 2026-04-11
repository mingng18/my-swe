// src/blueprints/__tests__/actions.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { ActionRegistry, actionRegistry, registerBuiltinActions } from "../actions";
import type { BlueprintState } from "../types";

describe("ActionRegistry", () => {
  let testRegistry: ActionRegistry;

  beforeEach(() => { testRegistry = new ActionRegistry(); });

  it("should register an action", () => {
    testRegistry.register({
      name: "test_action",
      description: "Test",
      execute: async () => ({ success: true }),
    });
    expect(testRegistry.has("test_action")).toBe(true);
  });
});

describe("Builtin Actions", () => {
  it("should register all builtin actions", () => {
    registerBuiltinActions();
    expect(actionRegistry.has("run_linters")).toBe(true);
    expect(actionRegistry.has("run_tests")).toBe(true);
    expect(actionRegistry.has("run_typecheck")).toBe(true);
    expect(actionRegistry.has("create_pr")).toBe(true);
  });
});
