import { createLogger } from "../utils/logger";
import { loadPipelineConfig } from "../utils/config";
import type { CodeagentStateType } from "../utils/state";
import { getSandboxBackendSync } from "../utils/sandboxState";

const logger = createLogger("validate");

/**
 * Validation result interface
 */
interface ValidationResult {
  passed: boolean;
  checks: {
    typescript?: boolean;
    dependencies?: boolean;
    build?: boolean;
  };
  output?: string;
}

/**
 * Deterministic node: Validate the codebase.
 *
 * Runs validation checks:
 * - TypeScript compilation check
 * - Dependency resolution
 * - Build verification
 *
 * Pure function — same input always produces same output.
 *
 * @param state - The current agent state
 * @returns Updated state with validation results
 */
export async function validateNode(state: CodeagentStateType) {
  const startedAt = Date.now();
  logger.info("[codeagent][deterministic][validate] in");

  try {
    const { workspaceRoot } = loadPipelineConfig();
    const workspaceDir = (state.configurable as any)?.repo?.workspaceDir as
      | string
      | undefined;
    const useSandbox = Boolean(workspaceDir);
    const root = useSandbox ? workspaceDir! : workspaceRoot || process.cwd();

    const BunModule = await import("bun");

    const checks: ValidationResult["checks"] = {};
    const outputs: string[] = [];

    // TypeScript check
    logger.info(
      "[codeagent][deterministic][validate] Running TypeScript check",
    );
    try {
      const { output: tsOutput, exitCode: tsExitCode } = await executeCommand({
        useSandbox,
        threadId: state.threadId || "",
        cwd: root,
        command: "bunx tsc --noEmit",
        BunModule,
      });

      checks.typescript = tsExitCode === 0;
      outputs.push(`TypeScript: ${checks.typescript ? "PASS" : "FAIL"}`);
      if (!checks.typescript && tsOutput) {
        outputs.push(`\nTypeScript errors:\n${tsOutput}`);
      }
    } catch (error) {
      checks.typescript = false;
      outputs.push(
        `TypeScript: ERROR - ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Dependency check
    logger.info("[codeagent][deterministic][validate] Checking dependencies");
    try {
      const { output: depOutput, exitCode: depExitCode } = await executeCommand({
        useSandbox,
        threadId: state.threadId || "",
        cwd: root,
        command: "bun install --frozen-lockfile --check",
        BunModule,
      });
      checks.dependencies = depExitCode === 0;
      outputs.push(`Dependencies: ${checks.dependencies ? "PASS" : "FAIL"}`);
      if (!checks.dependencies && depOutput) {
        outputs.push(`\nDependency check output:\n${depOutput}`);
      }
    } catch (error) {
      checks.dependencies = false;
      outputs.push(
        `Dependencies: ERROR - ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Build check (if build script exists)
    const packageJsonPath = `${root}/package.json`;
    try {
      const packageJsonText = await BunModule.file(packageJsonPath).text();
      const packageJson = JSON.parse(packageJsonText);

      if (packageJson.scripts?.build) {
        logger.info("[codeagent][deterministic][validate] Running build");
        const { output: buildOutput, exitCode: buildExitCode } =
          await executeCommand({
            useSandbox,
            threadId: state.threadId || "",
            cwd: root,
            command: "bun run build",
            BunModule,
          });

        checks.build = buildExitCode === 0;
        outputs.push(`Build: ${checks.build ? "PASS" : "FAIL"}`);
        if (!checks.build && buildOutput) {
          outputs.push(`\nBuild errors:\n${buildOutput}`);
        }
      }
    } catch (error) {
      logger.debug(
        { error },
        "[codeagent][deterministic][validate] No build script or error",
      );
    }

    const allPassed = Object.values(checks).every((v) => v === true);
    const validationResult: ValidationResult = {
      passed: allPassed,
      checks,
      output: outputs.join("\n\n"),
    };

    logger.info(
      { passed: allPassed, checks, elapsedMs: Date.now() - startedAt },
      "[codeagent][deterministic][validate] out",
    );

    return { validationResults: validationResult };
  } catch (error) {
    logger.error({ error }, "[codeagent][deterministic][validate] error");
    return {
      validationResults: {
        passed: false,
        checks: {},
        output: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function executeCommand(args: {
  useSandbox: boolean;
  threadId: string;
  cwd: string;
  command: string;
  BunModule: any;
}): Promise<{ output: string; exitCode: number }> {
  if (args.useSandbox) {
    const sandbox = getSandboxBackendSync(args.threadId);
    if (!sandbox) {
      throw new Error("Sandbox backend not available");
    }
    const result = await sandbox.execute(`cd "${args.cwd}" && ${args.command} 2>&1`);
    return { output: result.output || "", exitCode: result.exitCode ?? 1 };
  }

  const proc = args.BunModule.spawn(
    ["sh", "-c", `cd "${args.cwd}" && ${args.command}`],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = (await proc.exited) ?? 1;
  return { output: `${stdout}${stderr}`.trim(), exitCode };
}
