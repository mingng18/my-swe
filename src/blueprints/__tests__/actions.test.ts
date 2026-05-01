// src/blueprints/__tests__/actions.test.ts

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  ActionRegistry,
  actionRegistry,
  registerBuiltinActions,
  parseCommandArgs,
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

describe("parseCommandArgs", () => {
  it("should parse a simple command", () => {
    expect(parseCommandArgs("bun test")).toEqual({
      command: "bun",
      args: ["test"],
    });
  });

  it("should parse a command with double quotes", () => {
    expect(parseCommandArgs('bun test "src/my test.ts"')).toEqual({
      command: "bun",
      args: ["test", "src/my test.ts"],
    });
  });

  it("should parse a command with single quotes", () => {
    expect(parseCommandArgs("bun test 'src/my test.ts'")).toEqual({
      command: "bun",
      args: ["test", "src/my test.ts"],
    });
  });

  it("should handle empty strings", () => {
    expect(parseCommandArgs("")).toEqual({
      command: "",
      args: [],
    });
  });

  it("should parse a command with multiple arguments", () => {
    expect(parseCommandArgs("bunx tsc --noEmit")).toEqual({
      command: "bunx",
      args: ["tsc", "--noEmit"],
    });
  });
});

describe("Builtin Actions Execution", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should prevent arbitrary command execution in run_linters", async () => {
    process.env.LINTER_COMMAND = "rm -rf /";
    const action = actionRegistry.get("run_linters");
    const result = await action!.execute({} as any);

    expect(result.success).toBe(false);
    expect(result.error).toContain("not allowed for security reasons");
  });

  it("should prevent arbitrary command execution in run_tests", async () => {
    process.env.TEST_COMMAND = "cat /etc/passwd";
    const action = actionRegistry.get("run_tests");
    const result = await action!.execute({} as any);

    expect(result.success).toBe(false);
    expect(result.error).toContain("not allowed for security reasons");
  });

  it("should allow approved commands in run_linters", async () => {
    process.env.LINTER_COMMAND = "bunx --version";
    const action = actionRegistry.get("run_linters");
    const result = await action!.execute({} as any);

    // As long as it doesn't fail due to security reasons, it's fine.
    // It might fail because bunx --version doesn't return 0 or we don't mock execFile
    // but the error shouldn't be the security one.
    if (!result.success) {
      expect(result.error).not.toContain("not allowed for security reasons");
    }
  });
});
