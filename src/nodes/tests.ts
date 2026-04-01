import { shellEscapeSingleQuotes } from "../utils/shell";
import { createLogger } from "../utils/logger";
import { loadPipelineConfig } from "../utils/config";
import type { CodeagentStateType } from "../utils/state";
import { getSandboxBackendSync } from "../utils/sandboxState";

const logger = createLogger("tests");

/**
 * Test result interface
 */
interface TestResult {
  passed: boolean;
  summary?: string;
  output?: string;
}

/**
 * Deterministic node: Run the test suite and return pass/fail results.
 *
 * When in sandbox mode (workspaceDir in config), runs commands in the sandbox.
 * Otherwise runs locally on workspaceRoot.
 *
 * This is a pure function — given the same codebase state, it will always
 * return the same test results. No AI reasoning involved.
 *
 * @param state - The current agent state
 * @returns Updated state with test results
 */
export async function testsNode(state: CodeagentStateType) {
  const startedAt = Date.now();
  logger.info("[codeagent][deterministic][tests] in");

  try {
    const { workspaceRoot } = loadPipelineConfig();
    const workspaceDir = (state.configurable as any)?.repo?.workspaceDir as
      | string
      | undefined;

    // Check if we're in sandbox mode
    const useSandbox = Boolean(workspaceDir);
    const workDir = useSandbox ? workspaceDir : workspaceRoot || process.cwd();

    let testCommand: string;
    let testResult: TestResult;
    let output: string;
    let exitCode: number;

    // Check for package.json to determine test runner
    const BunModule = await import("bun");
    const packageJsonPath = `${workDir}/package.json`;

    try {
      const packageJsonText = await BunModule.file(packageJsonPath).text();
      const packageJson = JSON.parse(packageJsonText);

      // Determine test command based on package.json scripts
      if (packageJson.scripts?.test) {
        testCommand = "bun run test";
      } else if (packageJson.jest) {
        testCommand = "bunx jest";
      } else if (packageJson.vitest) {
        testCommand = "bunx vitest run";
      } else {
        // No test setup found
        logger.info("[codeagent][deterministic][tests] No test setup found");
        return {
          testResults: {
            passed: true,
            summary: "No tests configured",
            output: "",
          },
        };
      }

      logger.info(
        { testCommand, useSandbox, workDir },
        "[codeagent][deterministic][tests] Running tests",
      );

      if (useSandbox) {
        // Run in sandbox
        const sandbox = getSandboxBackendSync(state.threadId || "");
        if (!sandbox) {
          logger.error("[tests] Sandbox backend not available");
          return {
            testResults: {
              passed: false,
              summary: "Sandbox backend not available",
              output: "",
            },
          };
        }

        const result = await sandbox.execute(
          `cd ${shellEscapeSingleQuotes(workDir || "")} && ${testCommand} 2>&1`,
        );
        output = result.output;
        exitCode = result.exitCode ?? 1;
      } else {
        // Run locally
        const proc = BunModule.spawn(
          ["sh", "-c", `cd ${shellEscapeSingleQuotes(workDir || "")} && ${testCommand}`],
          {
            stdout: "pipe",
            stderr: "pipe",
          },
        );

        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        exitCode = (await proc.exited) ?? 1;
        output = stdout + stderr;
      }

      const passed = exitCode === 0;

      // Extract summary from output
      let summary = passed ? "Tests passed" : "Tests failed";
      if (output.includes("Test Suites:")) {
        const match = output.match(/Test Suites:.*?\n/);
        if (match) summary = match[0].trim();
      }

      testResult = {
        passed,
        summary,
        output,
      };

      logger.info(
        { passed, summary, elapsedMs: Date.now() - startedAt },
        "[codeagent][deterministic][tests] out",
      );
    } catch (error) {
      logger.error(
        { error },
        "[codeagent][deterministic][tests] Failed to run tests",
      );
      testResult = {
        passed: false,
        summary: "Test execution error",
        output: error instanceof Error ? error.message : String(error),
      };
    }

    return { testResults: testResult };
  } catch (error) {
    logger.error({ error }, "[codeagent][deterministic][tests] error");
    return {
      testResults: {
        passed: false,
        summary: "Node error",
        output: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
