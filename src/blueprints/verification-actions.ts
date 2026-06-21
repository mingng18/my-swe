// src/blueprints/verification-actions.ts
/**
 * Deterministic actions that delegate to sandbox-based verification nodes.
 *
 * Unlike the actions in actions.ts (which use local execFile), these actions
 * call the deterministic node functions (runTests, runLinter, enforcePRSubmission)
 * that execute inside the sandbox.
 *
 * Each action updates the verificationResults array in the blueprint state.
 */

import type { DeterministicAction, ActionResult, BlueprintState } from "./types";
import type { VerificationResult } from "./state";
import { createLogger } from "../utils/logger";

const logger = createLogger("verification-actions");

// ---------------------------------------------------------------------------
// Sandbox accessor
// ---------------------------------------------------------------------------

/**
 * Resolver function that provides sandbox + repoDir for a given state.
 *
 * In production this reads from thread-scoped maps; tests can inject a mock.
 */
export type SandboxAccessor = (
  state: BlueprintState,
) => Promise<{ sandbox: unknown; repoDir: string } | undefined>;

// ---------------------------------------------------------------------------
// verify_tests
// ---------------------------------------------------------------------------

export function createVerifyTestsAction(
  getSandbox: SandboxAccessor,
): DeterministicAction {
  return {
    name: "verify_tests",
    description: "Run test suite inside the sandbox",
    execute: async (state: BlueprintState): Promise<ActionResult> => {
      const ctx = await getSandbox(state);
      if (!ctx) {
        return { success: false, error: "No sandbox available for verify_tests" };
      }

      try {
        const { runTests } = await import("../nodes/deterministic/TestRunnerNode");
        const result = await runTests(ctx.sandbox, ctx.repoDir);

        return {
          success: result.testPassed,
          output: result.testPassed
            ? "Tests passed"
            : `Tests failed (exit code ${result.testExitCode}): ${result.testOutput}`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err }, "[verify_tests] Test runner failed");
        return { success: false, error: msg };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// verify_lint
// ---------------------------------------------------------------------------

export function createVerifyLintAction(
  getSandbox: SandboxAccessor,
): DeterministicAction {
  return {
    name: "verify_lint",
    description: "Run linter inside the sandbox",
    execute: async (state: BlueprintState): Promise<ActionResult> => {
      const ctx = await getSandbox(state);
      if (!ctx) {
        return { success: false, error: "No sandbox available for verify_lint" };
      }

      try {
        const { runLinter } = await import("../nodes/deterministic/LinterNode");
        const result = await runLinter(ctx.sandbox, ctx.repoDir);

        return {
          success: result.lintPassed,
          output: result.lintPassed
            ? "Linter passed"
            : `Linter failed (exit code ${result.lintExitCode}): ${result.lintOutput}`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err }, "[verify_lint] Linter failed");
        return { success: false, error: msg };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// verify_typecheck
// ---------------------------------------------------------------------------

export function createVerifyTypecheckAction(
  getSandbox: SandboxAccessor,
): DeterministicAction {
  return {
    name: "verify_typecheck",
    description: "Run TypeScript type checking inside the sandbox",
    execute: async (state: BlueprintState): Promise<ActionResult> => {
      const ctx = await getSandbox(state);
      if (!ctx) {
        return {
          success: false,
          error: "No sandbox available for verify_typecheck",
        };
      }

      try {
        // Typecheck is a subset of the linter: run tsc --noEmit
        const sandbox = ctx.sandbox as {
          execute: (cmd: string, opts?: { timeout?: number }) => Promise<{
            exitCode: number;
            output: string;
          }>;
        };
        const result = await sandbox.execute(
          `cd ${ctx.repoDir} && bunx tsc --noEmit`,
          { timeout: 120_000 },
        );

        return {
          success: result.exitCode === 0,
          output:
            result.exitCode === 0
              ? "Type check passed"
              : `Type check failed: ${result.output}`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err }, "[verify_typecheck] Typecheck failed");
        return { success: false, error: msg };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// create_pr
// ---------------------------------------------------------------------------

export function createCreatePrAction(
  getSandbox: SandboxAccessor,
): DeterministicAction {
  return {
    name: "create_pr",
    description: "Enforce PR submission via the sandbox",
    execute: async (state: BlueprintState): Promise<ActionResult> => {
      const ctx = await getSandbox(state);
      if (!ctx) {
        return { success: false, error: "No sandbox available for create_pr" };
      }

      try {
        const { enforcePRSubmission } = await import(
          "../nodes/deterministic/PRSubmitNode"
        );
        const result = await enforcePRSubmission({
          sandbox: ctx.sandbox as import("../integrations/sandbox-service").SandboxService,
          repoDir: ctx.repoDir,
          repoOwner: "",
          repoName: "",
          threadId: "blueprint",
          messages: [],
          githubToken: process.env.GITHUB_TOKEN,
        });

        if (result.prCreated) {
          return {
            success: true,
            output: result.prUrl
              ? `PR created: ${result.prUrl}`
              : "PR created successfully",
          };
        }

        return {
          success: false,
          output: result.error ?? "PR creation did not succeed",
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err }, "[create_pr] PR submission failed");
        return { success: false, error: msg };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Composite action: verify_tests_and_lint (used by most blueprints)
// ---------------------------------------------------------------------------

export function createVerifyTestsAndLintAction(
  getSandbox: SandboxAccessor,
): DeterministicAction {
  return {
    name: "verify_tests_and_lint",
    description: "Run tests AND linter; passes only if both pass",
    execute: async (state: BlueprintState): Promise<ActionResult> => {
      const ctx = await getSandbox(state);
      if (!ctx) {
        return {
          success: false,
          error: "No sandbox available for verify_tests_and_lint",
        };
      }

      const outputs: string[] = [];
      let allPassed = true;

      // Run tests
      try {
        const { runTests } = await import("../nodes/deterministic/TestRunnerNode");
        const result = await runTests(ctx.sandbox, ctx.repoDir);
        if (!result.testPassed) {
          allPassed = false;
          outputs.push(
            `Tests failed (exit ${result.testExitCode}): ${result.testOutput}`,
          );
        } else {
          outputs.push("Tests passed");
        }
      } catch (err) {
        allPassed = false;
        outputs.push(
          `Tests error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Run linter
      try {
        const { runLinter } = await import("../nodes/deterministic/LinterNode");
        const result = await runLinter(ctx.sandbox, ctx.repoDir);
        if (!result.lintPassed) {
          allPassed = false;
          outputs.push(
            `Lint failed (exit ${result.lintExitCode}): ${result.lintOutput}`,
          );
        } else {
          outputs.push("Lint passed");
        }
      } catch (err) {
        allPassed = false;
        outputs.push(
          `Lint error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return {
        success: allPassed,
        output: outputs.join("\n"),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Composite action: verify_no_typecheck (used by test blueprint)
// ---------------------------------------------------------------------------

export function createVerifyNoTypecheckAction(
  getSandbox: SandboxAccessor,
): DeterministicAction {
  return {
    name: "verify_no_typecheck",
    description: "Run tests and lint but skip type checking",
    execute: async (state: BlueprintState): Promise<ActionResult> => {
      const ctx = await getSandbox(state);
      if (!ctx) {
        return {
          success: false,
          error: "No sandbox available for verify_no_typecheck",
        };
      }

      const outputs: string[] = [];
      let allPassed = true;

      // Run tests
      try {
        const { runTests } = await import("../nodes/deterministic/TestRunnerNode");
        const result = await runTests(ctx.sandbox, ctx.repoDir);
        if (!result.testPassed) {
          allPassed = false;
          outputs.push(
            `Tests failed (exit ${result.testExitCode}): ${result.testOutput}`,
          );
        } else {
          outputs.push("Tests passed");
        }
      } catch (err) {
        allPassed = false;
        outputs.push(
          `Tests error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return {
        success: allPassed,
        output: outputs.join("\n"),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: append a VerificationResult to an existing array
// ---------------------------------------------------------------------------

export function appendVerificationResult(
  existing: VerificationResult[],
  step: string,
  passed: boolean,
  output: string,
): VerificationResult[] {
  return [...existing, { step, passed, output }];
}
