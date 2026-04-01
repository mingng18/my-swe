import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createLogger } from "../utils/logger";
import { loadPipelineConfig } from "../utils/config";
import type { CodeagentStateType } from "../utils/state";
import { getSandboxBackendSync } from "../utils/sandboxState";

const execAsync = promisify(exec);
const logger = createLogger("linter");

/**
 * Safely escapes a string for use as a shell argument.
 */
function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Deterministic node: same workspace + command → same exit code/output for a clean tree.
 * No LLM; provides an auditable gate after agentic generation (lint/typecheck).
 *
 * When in sandbox mode (workspaceDir in config), runs commands in the sandbox.
 * Otherwise runs locally on workspaceRoot.
 *
 * @see https://www.mindstudio.ai/blog/stripe-minions-blueprint-architecture-deterministic-agentic-nodes
 */
export async function linterNode(state: CodeagentStateType) {
  const startedAt = Date.now();
  if (state.error) {
    logger.info("[codeagent][deterministic][linter] skipped (coder error)");
    return {};
  }

  const { workspaceRoot, linterCommand } = loadPipelineConfig();
  const workspaceDir = (state.configurable as any)?.repo?.workspaceDir as
    | string
    | undefined;

  // Check if we're in sandbox mode
  const useSandbox = Boolean(workspaceDir);
  const workDir = useSandbox ? workspaceDir : workspaceRoot;

  logger.info(
    { useSandbox, workDir, linterCommand },
    "[codeagent][deterministic][linter]",
  );

  try {
    let stdout: string;
    let stderr: string;

    if (useSandbox) {
      // Run in sandbox
      const sandbox = getSandboxBackendSync(state.threadId || "");
      if (!sandbox) {
        logger.error("[linter] Sandbox backend not available");
        return {
          error: "Sandbox backend not available",
          linterResults: {
            success: false,
            exitCode: 1,
            output: "Sandbox backend not available",
          },
        };
      }

      const result = await sandbox.execute(
        `cd ${escapeShellArg(workDir as string)} && ${linterCommand} 2>&1`,
      );
      stdout = result.output;
      stderr = "";

      if (result.exitCode !== 0) {
        const combined = stdout.trim();
        const section =
          "\n\n---\nLinter (exit " +
          String(result.exitCode) +
          "):\n" +
          (combined || "Command failed");
        logger.info(
          { code: result.exitCode },
          "[codeagent][deterministic][linter] non-zero exit",
        );
        return {
          error: state.reply + section,
          linterResults: {
            success: false,
            exitCode: result.exitCode,
            output: combined || "Command failed",
          },
        };
      }
    } else {
      // Run locally
      const result = await execAsync(linterCommand, {
        cwd: workDir,
        maxBuffer: 512 * 1024,
        timeout: 120_000,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    }

    const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
    let reply = state.reply;
    if (combined) {
      reply += "\n\n---\nLinter (exit 0):\n" + combined;
    }
    logger.info(
      { elapsedMs: Date.now() - startedAt },
      "[codeagent][deterministic][linter] ok",
    );
    return {
      reply,
      linterResults: {
        success: true,
        exitCode: 0,
        output: combined,
      },
    };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    const combined = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
    const section =
      "\n\n---\nLinter (exit " +
      String(err.code ?? 1) +
      "):\n" +
      (combined || err.message || String(e));
    logger.info(
      { code: err.code, message: err.message },
      "[codeagent][deterministic][linter] non-zero or exec error",
    );
    return {
      error: state.reply + section,
      linterResults: {
        success: false,
        exitCode: typeof err.code === "number" ? err.code : 1,
        output: combined || err.message || String(e),
      },
    };
  }
}
