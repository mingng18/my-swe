import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";

// We import child_process dynamically in the mock, but we shouldn't mix node scripts and mocks.
// Let's remove the mock entirely from the main test and rely purely on the node scripts.

import { actionRegistry, registerBuiltinActions, parseCommandArgs } from "../../src/blueprints/actions";

describe("actions", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    try {
      registerBuiltinActions();
    } catch (e) {}
  });

  afterEach(() => {
    process.env = originalEnv;
    const files = ["/tmp/fail.js", "/tmp/success.js", "/tmp/fail_message.js"];
    for (const f of files) {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
      }
    }
  });

  describe("parseCommandArgs", () => {
    test("throws on forbidden characters", () => {
      expect(() => parseCommandArgs("bun test & echo hello")).toThrow("Command contains forbidden characters for security reasons");
    });

    test("handles empty command", () => {
      expect(parseCommandArgs("   ")).toEqual({ command: "", args: [], originalCommand: "" });
    });
  });

  describe("run_linters", () => {
    test("returns success when linters pass", async () => {
      const linter = actionRegistry.get("run_linters");
      fs.writeFileSync("/tmp/success.js", "console.log('mock_stdout_output');");
      process.env.LINTER_COMMAND = "node /tmp/success.js";

      const result = await linter!.execute({} as any);
      expect(result.success).toBe(true);
      expect((result as any).output).toContain("mock_stdout_output");
    });

    test("handles execution errors with stderr (via real script execution)", async () => {
      const linter = actionRegistry.get("run_linters");
      fs.writeFileSync("/tmp/fail.js", "process.stderr.write('mock_stderr_output'); process.exit(1);");
      process.env.LINTER_COMMAND = "node /tmp/fail.js";

      const result = await linter!.execute({} as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain("mock_stderr_output");
    });

    test("handles execution errors with fallback to generic message", async () => {
      const linter = actionRegistry.get("run_linters");
      fs.writeFileSync("/tmp/fail_message.js", "process.stdout.write('some output'); process.exit(2);");
      process.env.LINTER_COMMAND = "node /tmp/fail_message.js";

      const result = await linter!.execute({} as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Command failed:");
    });

    test("handles empty command gracefully", async () => {
      const linter = actionRegistry.get("run_linters");
      process.env.LINTER_COMMAND = "   ";
      const result = await linter!.execute({} as any);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Empty linter command");
    });

    test("handles forbidden command gracefully", async () => {
      const linter = actionRegistry.get("run_linters");
      process.env.LINTER_COMMAND = "not_allowed_command args";
      const result = await linter!.execute({} as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain("is not allowed for security reasons");
    });
  });

  describe("run_tests", () => {
    test("returns success when tests pass", async () => {
      const runTests = actionRegistry.get("run_tests");
      fs.writeFileSync("/tmp/success.js", "console.log('mock_test_stdout_output');");
      process.env.TEST_COMMAND = "node /tmp/success.js";

      const result = await runTests!.execute({} as any);
      expect(result.success).toBe(true);
      expect((result as any).output).toContain("mock_test_stdout_output");
    });

    test("handles execution errors with stderr", async () => {
      const runTests = actionRegistry.get("run_tests");
      fs.writeFileSync("/tmp/fail.js", "process.stderr.write('mock_test_stderr_output'); process.exit(1);");
      process.env.TEST_COMMAND = "node /tmp/fail.js";

      const result = await runTests!.execute({} as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain("mock_test_stderr_output");
    });

    test("handles execution errors with fallback to generic message", async () => {
      const runTests = actionRegistry.get("run_tests");
      fs.writeFileSync("/tmp/fail_message.js", "process.stdout.write('some output'); process.exit(2);");
      process.env.TEST_COMMAND = "node /tmp/fail_message.js";

      const result = await runTests!.execute({} as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Command failed:");
    });

    test("handles empty command gracefully", async () => {
      const runTests = actionRegistry.get("run_tests");
      process.env.TEST_COMMAND = "   ";
      const result = await runTests!.execute({} as any);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Empty test command");
    });

    test("handles forbidden command gracefully", async () => {
      const runTests = actionRegistry.get("run_tests");
      process.env.TEST_COMMAND = "not_allowed_command args";
      const result = await runTests!.execute({} as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain("is not allowed for security reasons");
    });
  });

  describe("run_typecheck", () => {
    test("is registered properly", () => {
      const runTypecheck = actionRegistry.get("run_typecheck");
      expect(runTypecheck).toBeDefined();
    });
  });

  describe("create_pr", () => {
    test("is registered properly and returns error", async () => {
      const createPr = actionRegistry.get("create_pr");
      const result = await createPr!.execute({} as any);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Not yet implemented");
    });
  });
});
