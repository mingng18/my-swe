// src/blueprints/__tests__/actions.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import {
  ActionRegistry,
  actionRegistry,
  registerBuiltinActions,
} from "../actions";
import type { BlueprintState } from "../types";

describe("ActionRegistry", () => {
  let testRegistry: ActionRegistry;

  beforeEach(() => {
    testRegistry = new ActionRegistry();
  });

  it("should register an action", () => {
    testRegistry.register({
      name: "test_action",
      description: "Test",
      execute: async () => ({ success: true }),
    });
    expect(testRegistry.has("test_action")).toBe(true);
  });

  it("should throw error when registering duplicate action", () => {
    testRegistry.register({
      name: "test_action",
      description: "Test",
      execute: async () => ({ success: true }),
    });
    expect(() => {
      testRegistry.register({
        name: "test_action",
        description: "Duplicate",
        execute: async () => ({ success: true }),
      });
    }).toThrow('Action "test_action" is already registered');
  });
});

describe("Builtin Actions", () => {
  it("should register all builtin actions", () => {
    // Call registerBuiltinActions - this should only be called once per test run
    // In production, this should be called at application startup
    registerBuiltinActions();
    expect(actionRegistry.has("run_linters")).toBe(true);
    expect(actionRegistry.has("run_tests")).toBe(true);
    expect(actionRegistry.has("run_typecheck")).toBe(true);
    expect(actionRegistry.has("create_pr")).toBe(true);
  });

  it("should throw error when registering builtin actions twice", () => {
    expect(() => {
      registerBuiltinActions();
    }).toThrow(/already registered/);
  });
});
