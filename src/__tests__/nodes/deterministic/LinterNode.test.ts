import { describe, expect, it } from "bun:test";
import { formatLintResults } from "../../../nodes/deterministic/LinterNode";

describe("formatLintResults", () => {
  it("should return a success message when lintPassed is true", () => {
    const state = {
      lintPassed: true,
      lintExitCode: 0,
      lintOutput: "Success output that should be ignored",
    };

    const result = formatLintResults(state);

    expect(result).toBe("✅ Linter passed");
  });

  it("should return a failure message with exit code and output when lintPassed is false", () => {
    const state = {
      lintPassed: false,
      lintExitCode: 1,
      lintOutput: "Error: Unexpected any. Specify a different type.",
    };

    const result = formatLintResults(state);

    expect(result).toBe(`❌ Linter failed (exit code 1)\n\nError: Unexpected any. Specify a different type.`);
  });

  it("should handle empty lint output when lintPassed is false", () => {
    const state = {
      lintPassed: false,
      lintExitCode: 2,
      lintOutput: "",
    };

    const result = formatLintResults(state);

    expect(result).toBe(`❌ Linter failed (exit code 2)\n\n`);
  });
});
