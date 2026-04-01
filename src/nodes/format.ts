import { createLogger } from "../utils/logger";
import { loadPipelineConfig } from "../utils/config";
import type { CodeagentStateType } from "../utils/state";
import { getSandboxBackendSync } from "../utils/sandboxState";

const logger = createLogger("format");

/**
 * Format result interface
 */
interface FormatResult {
  success: boolean;
  filesChanged?: number;
  output?: string;
}

/**
 * Deterministic node: Apply formatting to the codebase.
 *
 * When in sandbox mode (workspaceDir in config), runs commands in the sandbox.
 * Otherwise runs locally on workspaceRoot.
 *
 * Runs prettier/biome to format files according to configured rules.
 * Pure function — same input always produces same output.
 *
 * @param state - The current agent state
 * @returns Updated state with format results
 */
export async function formatNode(state: CodeagentStateType) {
  const startedAt = Date.now();
  logger.info("[codeagent][deterministic][format] in");

  try {
    const { workspaceRoot } = loadPipelineConfig();
    const workspaceDir = (state.configurable as any)?.repo?.workspaceDir as string | undefined;

    // Check if we're in sandbox mode
    const useSandbox = Boolean(workspaceDir);
    const workDir = useSandbox ? workspaceDir : workspaceRoot || process.cwd();

    const BunModule = await import("bun");

    // Check for formatting config
    const hasPrettier =
      (await exists(`${workDir}/.prettierrc`, BunModule)) ||
      (await exists(`${workDir}/.prettierrc.json`, BunModule)) ||
      (await exists(`${workDir}/.prettierrc.js`, BunModule)) ||
      (await exists(`${workDir}/prettier.config.js`, BunModule));

    const hasBiome = await exists(`${workDir}/biome.json`, BunModule);

    let formatResult: FormatResult;

    if (useSandbox) {
      // Run in sandbox
      const sandbox = getSandboxBackendSync(state.threadId || "");
      if (!sandbox) {
        logger.error("[format] Sandbox backend not available");
        return {
          formatResults: {
            success: false,
            output: "Sandbox backend not available",
          },
        };
      }

      if (hasBiome) {
        // Use Biome for formatting
        logger.info("[codeagent][deterministic][format] Using Biome in sandbox");

        const result = await sandbox.execute(`cd "${workDir}" && bunx biome format --write . 2>&1`);
        const output = result.output;

        // Parse output for files changed
        const match = output.match(/(\d+) formatted/);
        const filesChanged = match ? parseInt(match[1], 10) : 0;

        formatResult = {
          success: result.exitCode === 0,
          filesChanged,
          output,
        };
      } else if (hasPrettier) {
        // Use Prettier for formatting
        logger.info("[codeagent][deterministic][format] Using Prettier in sandbox");

        const result = await sandbox.execute(`cd "${workDir}" && bunx prettier --write . 2>&1`);

        formatResult = {
          success: result.exitCode === 0,
          output: result.output,
        };
      } else {
        // No formatter configured
        logger.info("[codeagent][deterministic][format] No formatter configured");
        formatResult = {
          success: true,
          output: "No formatter configured",
        };
      }
    } else {
      // Run locally
      if (hasBiome) {
        // Use Biome for formatting
        logger.info("[codeagent][deterministic][format] Using Biome locally");

        const proc = BunModule.spawn(
          ["sh", "-c", `cd "${workDir}" && bunx biome format --write .`],
          {
            stdout: "pipe",
            stderr: "pipe",
          },
        );

        const output = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;

        // Parse output for files changed
        const match = output.match(/(\d+) formatted/);
        const filesChanged = match ? parseInt(match[1], 10) : 0;

        formatResult = {
          success: exitCode === 0,
          filesChanged,
          output: output + stderr,
        };
      } else if (hasPrettier) {
        // Use Prettier for formatting
        logger.info("[codeagent][deterministic][format] Using Prettier locally");

        const proc = BunModule.spawn(
          ["sh", "-c", `cd "${workDir}" && bunx prettier --write .`],
          {
            stdout: "pipe",
            stderr: "pipe",
          },
        );

        const output = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;

        formatResult = {
          success: exitCode === 0,
          output: output + stderr,
        };
      } else {
        // No formatter configured
        logger.info("[codeagent][deterministic][format] No formatter configured");
        formatResult = {
          success: true,
          output: "No formatter configured",
        };
      }
    }

    logger.info(
      {
        success: formatResult.success,
        filesChanged: formatResult.filesChanged,
        elapsedMs: Date.now() - startedAt,
      },
      "[codeagent][deterministic][format] out",
    );

    return { formatResults: formatResult };
  } catch (error) {
    logger.error({ error }, "[codeagent][deterministic][format] error");
    return {
      formatResults: {
        success: false,
        output: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Check if a file exists
 */
async function exists(path: string, BunModule: any): Promise<boolean> {
  try {
    return await BunModule.file(path).exists();
  } catch {
    return false;
  }
}
