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
      command: process.execPath,
      args: ["test"],
    });
  });

  it("should parse a command with double quotes", () => {
    expect(parseCommandArgs('bun test "src/my test.ts"')).toEqual({
      command: process.execPath,
      args: ["test", "src/my test.ts"],
    });
  });

  it("should parse a command with single quotes", () => {
    expect(parseCommandArgs("bun test 'src/my test.ts'")).toEqual({
      command: process.execPath,
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
      command: process.execPath,
      args: ["x", "tsc", "--noEmit"],
    });
  });

  it("should handle strange spacing and multiple spaces between args", () => {
    expect(parseCommandArgs("  bun   test    src/file.ts  ")).toEqual({
      command: process.execPath,
      args: ["test", "src/file.ts"],
    });
  });

  it("should handle whitespace-only strings", () => {
    expect(parseCommandArgs("   \t\n  ")).toEqual({
      command: "",
      args: [],
    });
  });

  it("should not rewrite paths for commands other than bun and bunx", () => {
    expect(parseCommandArgs("npm run dev")).toEqual({
      command: "npm",
      args: ["run", "dev"],
    });
  });

  it("should handle bun command with no arguments", () => {
    expect(parseCommandArgs("bun")).toEqual({
      command: process.execPath,
      args: [],
    });
  });

  it("should handle bunx command with no arguments", () => {
    expect(parseCommandArgs("bunx")).toEqual({
      command: process.execPath,
      args: ["x"],
    });
  });

  it("should handle mixed quotes handling", () => {
    expect(parseCommandArgs('bun run "my script" \'with args\'')).toEqual({
      command: process.execPath,
      args: ["run", "my script", "with args"],
    });
  });
});



describe("Security Validation", () => {
  it("should reject unallowed commands in run_tests", async () => {
    process.env.TEST_COMMAND = "rm -rf /";
    const runTestsAction = actionRegistry.get("run_tests");
    if (!runTestsAction) throw new Error("Action not found");
    const result = await runTestsAction.execute({} as any);
    expect(result.success).toBe(false);
    expect(result.error).toContain("is not allowed for security reasons");
  });

  it("should reject unallowed commands in run_linters", async () => {
    process.env.LINTER_COMMAND = "curl http://malicious.com";
    const runLintersAction = actionRegistry.get("run_linters");
    if (!runLintersAction) throw new Error("Action not found");
    const result = await runLintersAction.execute({} as any);
    expect(result.success).toBe(false);
    expect(result.error).toContain("is not allowed for security reasons");
  });
});
