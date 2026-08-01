import { test, expect, describe, beforeEach, mock } from "bun:test";

let triggerEmptyError = false;

mock.module("child_process", () => ({
  execFile: (command: any, args: any, callback: any) => {
    const cb = typeof args === "function" ? args : callback;
    if (triggerEmptyError) {
      cb({}, "", "");
    } else {
      cb(new Error("mock"), "", "");
    }
  }
}));

import { actionRegistry, registerBuiltinActions } from "../../src/blueprints/actions";

describe("actions fallback error paths", () => {
  beforeEach(() => {
    triggerEmptyError = true;
    try {
      registerBuiltinActions();
    } catch (e) {}
  });

  test("run_linters handles empty error fallback", async () => {
    const linter = actionRegistry.get("run_linters");
    process.env.LINTER_COMMAND = "bunx tsc"; // bypass forbidden check
    const result = await linter!.execute({} as any);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Linters failed");
  });

  test("run_tests handles empty error fallback", async () => {
    const runTests = actionRegistry.get("run_tests");
    process.env.TEST_COMMAND = "bun test";
    const result = await runTests!.execute({} as any);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Tests failed");
  });

  test("run_typecheck handles empty error fallback", async () => {
    const runTypecheck = actionRegistry.get("run_typecheck");
    const result = await runTypecheck!.execute({} as any);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Type check failed");
  });
});
