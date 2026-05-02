import { describe, expect, test, mock, beforeEach } from "bun:test";
import { runLinter, formatLintResults } from "../../../nodes/deterministic/LinterNode";

describe("LinterNode", () => {
  let mockSandbox: any;

  beforeEach(() => {
    mockSandbox = {
      execute: mock().mockResolvedValue({
        exitCode: 0,
        output: "Mock lint output",
      }),
    };
  });

  describe("runLinter", () => {
    test("returns passed state when sandbox execution has exitCode 0", async () => {
      const result = await runLinter(mockSandbox, "/tmp/repo");

      expect(mockSandbox.execute).toHaveBeenCalled();
      expect(result.lintPassed).toBe(true);
      expect(result.lintExitCode).toBe(0);
      expect(result.lintOutput).toBe("Mock lint output");
    });

    test("returns failed state when sandbox execution has exitCode > 0", async () => {
      mockSandbox.execute.mockResolvedValueOnce({
        exitCode: 1,
        output: "Lint errors found",
      });

      const result = await runLinter(mockSandbox, "/tmp/repo");

      expect(mockSandbox.execute).toHaveBeenCalled();
      expect(result.lintPassed).toBe(false);
      expect(result.lintExitCode).toBe(1);
      expect(result.lintOutput).toBe("Lint errors found");
    });

    test("returns failed state when sandbox execution throws an error", async () => {
      mockSandbox.execute.mockRejectedValueOnce(new Error("Sandbox timeout"));

      const result = await runLinter(mockSandbox, "/tmp/repo");

      expect(mockSandbox.execute).toHaveBeenCalled();
      expect(result.lintPassed).toBe(false);
      expect(result.lintExitCode).toBe(-1);
      expect(result.lintOutput).toBe("Sandbox timeout");
    });
  });

  describe("formatLintResults", () => {
    test("formats correctly when linter passed", () => {
      const state = {
        lintPassed: true,
        lintExitCode: 0,
        lintOutput: "",
      };

      const formatted = formatLintResults(state);
      expect(formatted).toBe("✅ Linter passed");
    });

    test("formats correctly when linter failed", () => {
      const state = {
        lintPassed: false,
        lintExitCode: 1,
        lintOutput: "Syntax error on line 42",
      };

      const formatted = formatLintResults(state);
      expect(formatted).toBe("❌ Linter failed (exit code 1)\n\nSyntax error on line 42");
    });
  });
});
