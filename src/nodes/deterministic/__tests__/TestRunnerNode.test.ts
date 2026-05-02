import { describe, it, expect, mock, beforeEach } from "bun:test";
import { runTests, formatTestResults, TestRunnerNodeState } from "../TestRunnerNode";

describe("TestRunnerNode", () => {
  let mockSandbox: any;
  let onProgressMock: ReturnType<typeof mock>;

  beforeEach(() => {
    onProgressMock = mock();
    mockSandbox = {
      execute: mock().mockResolvedValue({
        exitCode: 0,
        output: "Test run successful",
      }),
    };
  });

  describe("runTests", () => {
    it("should successfully run tests and emit progress events", async () => {
      const result = await runTests(mockSandbox, "/fake/repo", {
        onProgress: onProgressMock,
      });

      expect(mockSandbox.execute).toHaveBeenCalledWith(
        "cd /fake/repo && npm test",
        { timeout: 300000 }
      );

      expect(result.testPassed).toBe(true);
      expect(result.testExitCode).toBe(0);
      expect(result.testOutput).toBe("Test run successful");

      // Check progress events
      expect(onProgressMock).toHaveBeenCalledTimes(3);
      expect(onProgressMock.mock.calls[0][0]).toMatchObject({
        stage: "detecting",
        message: "Detecting test command...",
      });
      expect(onProgressMock.mock.calls[1][0]).toMatchObject({
        stage: "running",
        testCommand: "npm test",
        message: "Running tests: npm test",
      });
      expect(onProgressMock.mock.calls[2][0]).toMatchObject({
        stage: "complete",
        testCommand: "npm test",
        message: "Tests passed",
        outputLength: "Test run successful".length,
      });
    });

    it("should handle test failures correctly", async () => {
      mockSandbox.execute.mockResolvedValueOnce({
        exitCode: 1,
        output: "Tests failed with errors",
      });

      const result = await runTests(mockSandbox, "/fake/repo", {
        onProgress: onProgressMock,
      });

      expect(result.testPassed).toBe(false);
      expect(result.testExitCode).toBe(1);
      expect(result.testOutput).toBe("Tests failed with errors");

      expect(onProgressMock).toHaveBeenCalledTimes(3);
      expect(onProgressMock.mock.calls[2][0]).toMatchObject({
        stage: "failed",
        testCommand: "npm test",
        message: "Tests failed",
      });
    });

    it("should handle sandbox execution errors", async () => {
      mockSandbox.execute.mockRejectedValueOnce(new Error("Sandbox crashed"));

      const result = await runTests(mockSandbox, "/fake/repo", {
        onProgress: onProgressMock,
      });

      expect(result.testPassed).toBe(false);
      expect(result.testExitCode).toBe(-1);
      expect(result.testOutput).toBe("Sandbox crashed");

      expect(onProgressMock).toHaveBeenCalledTimes(3);
      expect(onProgressMock.mock.calls[2][0]).toMatchObject({
        stage: "failed",
        testCommand: "npm test",
        message: "Test execution error: Sandbox crashed",
      });
    });

    it("should handle non-Error sandbox execution errors", async () => {
      mockSandbox.execute.mockRejectedValueOnce("String error");

      const result = await runTests(mockSandbox, "/fake/repo", {
        onProgress: onProgressMock,
      });

      expect(result.testPassed).toBe(false);
      expect(result.testExitCode).toBe(-1);
      expect(result.testOutput).toBe("String error");

      expect(onProgressMock).toHaveBeenCalledTimes(3);
      expect(onProgressMock.mock.calls[2][0]).toMatchObject({
        stage: "failed",
        testCommand: "npm test",
        message: "Test execution error: String error",
      });
    });

    it("should work without options/onProgress", async () => {
      const result = await runTests(mockSandbox, "/fake/repo");

      expect(result.testPassed).toBe(true);
      expect(mockSandbox.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe("formatTestResults", () => {
    it("should format passing test results", () => {
      const state: TestRunnerNodeState = {
        testPassed: true,
        testExitCode: 0,
        testOutput: "success",
      };
      expect(formatTestResults(state)).toBe("✅ Tests passed");
    });

    it("should format failing test results", () => {
      const state: TestRunnerNodeState = {
        testPassed: false,
        testExitCode: 1,
        testOutput: "some failure output",
      };
      expect(formatTestResults(state)).toBe("❌ Tests failed (exit code 1)\n\nsome failure output");
    });
  });
});
