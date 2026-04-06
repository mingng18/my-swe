/**
 * Deterministic Nodes Index
 *
 * Exports all deterministic nodes for use in the verification pipeline.
 *
 * Deterministic nodes:
 * - No LLM calls
 * - Pure execution
 * - Always run when invoked
 * - Used for verification and enforcement
 */

import { createLogger } from "../../utils/logger";

const logger = createLogger("verification-pipeline");

export {
  runTests,
  formatTestResults,
  type TestRunnerNodeState,
} from "./TestRunnerNode";

export {
  runLinter,
  formatLintResults,
  type LinterNodeState,
} from "./LinterNode";

export {
  enforcePRSubmission,
  formatPRResults,
  wasPrToolCalled,
  type PRSubmitNodeState,
} from "./PRSubmitNode";

export {
  installDependencies,
  formatInstallationResults,
  type DependencyInstallerResult,
} from "./DependencyInstallerNode";

/**
 * Run the full verification pipeline
 *
 * This runs dependency installation, tests, linting, and enforces PR submission in order.
 * If any step fails, execution stops (unless continueOnFailure is true).
 */
export async function runVerificationPipeline(params: {
  sandbox: any;
  repoDir: string;
  repoOwner: string;
  repoName: string;
  threadId: string;
  messages: any[];
  githubToken?: string;
  branchName?: string;
  requireTests?: boolean;
  requireLint?: boolean;
}): Promise<{
  dependenciesInstalled?: boolean;
  testsPassed?: boolean;
  lintPassed?: boolean;
  prCreated?: boolean;
  prUrl?: string;
  error?: string;
}> {
  const results: any = {};

  // Install dependencies first (before tests/linting)
  const { installDependencies: installDeps } =
    await import("./DependencyInstallerNode");
  const depResults = await installDeps(params.sandbox, params.repoDir);
  results.dependenciesInstalled = depResults.installed;

  // Log if dependencies were installed or already present
  if (depResults.installed) {
    logger.info(
      { packageManager: depResults.packageManager },
      "[VerificationPipeline] Dependencies installed",
    );
  } else if (depResults.packageManager === null) {
    logger.info(
      "[VerificationPipeline] No package manager found or dependencies already present",
    );
  } else {
    logger.warn(
      { output: depResults.output },
      "[VerificationPipeline] Dependency installation failed, continuing anyway",
    );
  }

  // Run tests if required
  if (params.requireTests !== false) {
    const { runTests: runTestsNode } = await import("./TestRunnerNode");
    const testResults = await runTestsNode(params.sandbox, params.repoDir);
    results.testsPassed = testResults.testPassed;

    if (!testResults.testPassed) {
      return {
        ...results,
        error: "Tests failed",
      };
    }
  }

  // Run linter if required
  if (params.requireLint !== false) {
    const { runLinter: runLinterNode } = await import("./LinterNode");
    const lintResults = await runLinterNode(params.sandbox, params.repoDir);
    results.lintPassed = lintResults.lintPassed;

    if (!lintResults.lintPassed) {
      return {
        ...results,
        error: "Linter failed",
      };
    }
  }

  // Enforce PR submission
  const { enforcePRSubmission: enforcePR } = await import("./PRSubmitNode");
  const prResults = await enforcePR(params);
  results.prCreated = prResults.prCreated;
  results.prUrl = prResults.prUrl;

  if (prResults.error) {
    return {
      ...results,
      error: prResults.error,
    };
  }

  return results;
}
