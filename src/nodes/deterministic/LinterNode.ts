/**
 * Deterministic Node: Linter
 *
 * Runs linter and type checker. No LLM calls - pure execution.
 *
 * This node ensures linting is ALWAYS run after code changes,
 * regardless of whether the agent remembers to do it.
 */

import { createLogger } from "../../utils/logger";

const logger = createLogger("linter-node");

export interface LinterNodeState {
  lintPassed: boolean;
  lintExitCode: number;
  lintOutput: string;
}

/**
 * Detect lint command from repository
 */
function detectLintCommand(repoDir: string): string | null {
  const commands = [
    // TypeScript/JavaScript
    { file: "package.json", script: "lint", command: "npm run lint" },
    { file: "package.json", command: "bunx tsc --noEmit" },
    { file: "package.json", command: "bunx eslint ." },
    // Python
    { file: "pyproject.toml", command: "ruff check ." },
    { file: "pyproject.toml", command: "black --check ." },
    { file: "pyproject.toml", command: "mypy ." },
    // Rust
    { file: "Cargo.toml", command: "cargo clippy" },
    // Go
    { file: "go.mod", command: "gofmt -l ." },
  ];

  // Default to TypeScript check for TS projects
  return "bunx tsc --noEmit";
}

/**
 * Run linter in the sandbox
 */
export async function runLinter(
  sandbox: any,
  repoDir: string,
): Promise<LinterNodeState> {
  logger.info({ repoDir }, "[LinterNode] Running linter");

  const lintCommand = detectLintCommand(repoDir);

  if (!lintCommand) {
    logger.warn(
      { repoDir },
      "[LinterNode] No lint command detected, skipping",
    );
    return {
      lintPassed: true, // No linter = pass
      lintExitCode: 0,
      lintOutput: "No linter configured",
    };
  }

  try {
    const result = await sandbox.execute(`cd ${repoDir} && ${lintCommand}`, {
      timeout: 120000, // 2 minutes
    });

    const passed = result.exitCode === 0;

    logger.info(
      {
        lintCommand,
        exitCode: result.exitCode,
        passed,
        outputLength: result.output?.length || 0,
      },
      "[LinterNode] Linter execution completed",
    );

    return {
      lintPassed: passed,
      lintExitCode: result.exitCode,
      lintOutput: result.output || "",
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMsg }, "[LinterNode] Linter execution failed");

    return {
      lintPassed: false,
      lintExitCode: -1,
      lintOutput: errorMsg,
    };
  }
}

/**
 * Format lint results for display
 */
export function formatLintResults(state: LinterNodeState): string {
  if (state.lintPassed) {
    return "✅ Linter passed";
  }

  return `❌ Linter failed (exit code ${state.lintExitCode})\n\n${state.lintOutput}`;
}
