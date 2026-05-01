import { describe, expect, it } from "bun:test";
import { formatTestResults } from "../TestRunnerNode";

describe("formatTestResults", () => {
  it("returns passing message when tests passed", () => {
    const result = formatTestResults({
      testPassed: true,
      testExitCode: 0,
      testOutput: "All tests passed!",
    });
    expect(result).toBe("✅ Tests passed");
  });

  it("returns failing message with exit code and output when tests fail", () => {
    const result = formatTestResults({
      testPassed: false,
      testExitCode: 1,
      testOutput: "Error: expect(true).toBe(false)\n    at test.js:4:5",
    });
    expect(result).toBe("❌ Tests failed (exit code 1)\n\nError: expect(true).toBe(false)\n    at test.js:4:5");
  });

  it("handles empty output for failing tests", () => {
    const result = formatTestResults({
      testPassed: false,
      testExitCode: 2,
      testOutput: "",
    });
    expect(result).toBe("❌ Tests failed (exit code 2)\n\n");
  });
});
