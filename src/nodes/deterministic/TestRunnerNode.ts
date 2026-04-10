/**
 * Deterministic Node: Test Runner
 *
 * Runs tests and returns results. No LLM calls - pure execution.
 *
 * This node ensures tests are ALWAYS run after code changes,
 * regardless of whether the agent remembers to do it.
 */

import { createLogger } from "../../utils/logger";

const logger = createLogger("test-runner-node");

export interface TestRunnerNodeState {
  testPassed: boolean;
  testExitCode: number;
  testOutput: string;
}

/**
 * Progress callback type for test execution updates.
 */
export type TestRunnerProgress = {
  stage: "detecting" | "running" | "complete" | "failed";
  testCommand?: string;
  message: string;
  outputLength?: number;
};

/**
 * Options for test execution.
 */
export interface TestRunnerOptions {
  onProgress?: (progress: TestRunnerProgress) => void;
}

/**
 * Detect test command from repository
 */
function detectTestCommand(repoDir: string): string | null {
  const commands = [
    // npm/yarn/bun
    { file: "package.json", command: "npm test" },
    { file: "package.json", command: "bun test" },
    { file: "package.json", command: "yarn test" },
    // Python
    { file: "pyproject.toml", command: "pytest" },
    { file: "requirements.txt", command: "pytest" },
    // Rust
    { file: "Cargo.toml", command: "cargo test" },
    // Go
    { file: "go.mod", command: "go test ./..." },
  ];

  // Simple detection - just return npm test for now
  // In a full implementation, would read package.json and check for test script
  return "npm test";
}

/**
 * Run tests in the sandbox
 */
export async function runTests(
  sandbox: any,
  repoDir: string,
  options?: TestRunnerOptions,
): Promise<TestRunnerNodeState> {
  const { onProgress } = options || {};

  const emitProgress = (
    stage: TestRunnerProgress["stage"],
    message: string,
    testCommand?: string,
    outputLength?: number,
  ) => {
    if (onProgress) {
      onProgress({ stage, testCommand, message, outputLength });
    }
  };

  logger.info({ repoDir }, "[TestRunnerNode] Running tests");
  emitProgress("detecting", "Detecting test command...");

  const testCommand = detectTestCommand(repoDir);

  if (!testCommand) {
    logger.warn(
      { repoDir },
      "[TestRunnerNode] No test command detected, skipping",
    );
    emitProgress("complete", "No tests configured");
    return {
      testPassed: true, // No tests = pass
      testExitCode: 0,
      testOutput: "No tests configured",
    };
  }

  emitProgress("running", `Running tests: ${testCommand}`, testCommand);

  try {
    const result = await sandbox.execute(`cd ${repoDir} && ${testCommand}`, {
      timeout: 300000, // 5 minutes
    });

    const passed = result.exitCode === 0;
    const outputLength = result.output?.length || 0;

    logger.info(
      {
        testCommand,
        exitCode: result.exitCode,
        passed,
        outputLength,
      },
      "[TestRunnerNode] Test execution completed",
    );

    if (passed) {
      emitProgress("complete", "Tests passed", testCommand, outputLength);
    } else {
      emitProgress("failed", "Tests failed", testCommand, outputLength);
    }

    return {
      testPassed: passed,
      testExitCode: result.exitCode,
      testOutput: result.output || "",
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMsg }, "[TestRunnerNode] Test execution failed");

    emitProgress("failed", `Test execution error: ${errorMsg}`, testCommand);

    return {
      testPassed: false,
      testExitCode: -1,
      testOutput: errorMsg,
    };
  }
}

/**
 * Format test results for display
 */
export function formatTestResults(state: TestRunnerNodeState): string {
  if (state.testPassed) {
    return "✅ Tests passed";
  }

  return `❌ Tests failed (exit code ${state.testExitCode})\n\n${state.testOutput}`;
}
