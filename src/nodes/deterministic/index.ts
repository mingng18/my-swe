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

/**
 * Run the full verification pipeline
 *
 * This runs tests, linting, and enforces PR submission in order.
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
  testsPassed?: boolean;
  lintPassed?: boolean;
  prCreated?: boolean;
  prUrl?: string;
  error?: string;
}> {
  const results: any = {};

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
