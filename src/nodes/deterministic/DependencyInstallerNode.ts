/**
 * Deterministic Node: Dependency Installer
 *
 * Installs project dependencies before running linter/tests.
 * No LLM calls - pure execution.
 *
 * This node ensures dependencies are installed before any
 * verification steps that require them (TypeScript checks, tests, etc.).
 */

import { createLogger } from "../../utils/logger";
import { shellEscapeSingleQuotes } from "../../utils/shell";

const logger = createLogger("dependency-installer-node");

/**
 * Progress callback type for dependency installation updates.
 */
export type DependencyInstallProgress = {
  stage: "detecting" | "checking" | "installing" | "complete" | "failed";
  packageManager?: string;
  message: string;
};

/**
 * Options for dependency installation.
 */
export interface DependencyInstallerOptions {
  onProgress?: (progress: DependencyInstallProgress) => void;
}

/**
 * Sandbox backend interface for dependency installation.
 * Defines the minimum contract required for sandbox operations.
 */
interface SandboxBackend {
  execute(
    command: string,
    options?: { timeout?: number },
  ): Promise<{
    output: string;
    exitCode?: number;
    truncated?: boolean;
  }>;
}

export interface DependencyInstallerResult {
  installed: boolean;
  packageManager: string | null;
  output: string;
}

/**
 * Detect the package manager used by the repository.
 */
async function detectPackageManager(
  sandbox: SandboxBackend,
  repoDir: string,
): Promise<string | null> {
  const lockFiles = [
    { file: "bun.lockb", manager: "bun" },
    { file: "package-lock.json", manager: "npm" },
    { file: "yarn.lock", manager: "yarn" },
    { file: "pnpm-lock.yaml", manager: "pnpm" },
  ];

  for (const { file, manager } of lockFiles) {
    try {
      const escapedDir = shellEscapeSingleQuotes(repoDir);
      const result = await sandbox.execute(
        `test -f ${escapedDir}/${file} && echo "exists" || echo "not_found"`,
      );
      if (result.output.trim() === "exists") {
        logger.info(
          { lockFile: file, manager },
          "[DependencyInstaller] Detected package manager",
        );
        return manager;
      }
    } catch {
      // Continue to next lock file
    }
  }

  // Check for package.json as fallback (default to bun for this project)
  try {
    const escapedDir = shellEscapeSingleQuotes(repoDir);
    const result = await sandbox.execute(
      `test -f ${escapedDir}/package.json && echo "exists" || echo "not_found"`,
    );
    if (result.output.trim() === "exists") {
      logger.info(
        "[DependencyInstaller] Found package.json, defaulting to bun",
      );
      return "bun";
    }
  } catch {
    // No package manager found
  }

  return null;
}

/**
 * Check if node_modules already exists and appears complete.
 */
async function hasNodeModules(
  sandbox: SandboxBackend,
  repoDir: string,
): Promise<boolean> {
  try {
    const escapedDir = shellEscapeSingleQuotes(repoDir);
    const result = await sandbox.execute(
      `test -d ${escapedDir}/node_modules && echo "exists" || echo "not_found"`,
    );
    if (result.output.trim() !== "exists") {
      return false;
    }

    // Check if node_modules is not empty (basic completeness check)
    const checkResult = await sandbox.execute(
      `ls -A ${escapedDir}/node_modules | head -1`,
    );
    return checkResult.output.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Install dependencies for the repository if not already installed.
 */
export async function installDependencies(
  sandbox: SandboxBackend,
  repoDir: string,
  options?: DependencyInstallerOptions,
): Promise<DependencyInstallerResult> {
  const { onProgress } = options || {};

  const emitProgress = (
    stage: DependencyInstallProgress["stage"],
    message: string,
    packageManager?: string,
  ) => {
    if (onProgress) {
      onProgress({ stage, packageManager, message });
    }
  };

  logger.info({ repoDir }, "[DependencyInstaller] Checking dependencies");
  emitProgress("checking", "Checking for existing dependencies...");

  // Check if node_modules exists and is not empty
  const hasDeps = await hasNodeModules(sandbox, repoDir);
  if (hasDeps) {
    logger.info(
      "[DependencyInstaller] node_modules already exists, skipping installation",
    );
    emitProgress("complete", "Dependencies already installed");
    return {
      installed: false,
      packageManager: null,
      output: "Dependencies already installed",
    };
  }

  emitProgress("detecting", "Detecting package manager...");

  // Detect package manager
  const packageManager = await detectPackageManager(sandbox, repoDir);
  if (!packageManager) {
    logger.warn(
      "[DependencyInstaller] No package manager detected, skipping installation",
    );
    emitProgress("complete", "No package manager found");
    return {
      installed: false,
      packageManager: null,
      output: "No package manager found",
    };
  }

  emitProgress(
    "installing",
    `Installing dependencies with ${packageManager}...`,
    packageManager,
  );

  // Map package manager to install command
  const installCommands: Record<string, string> = {
    bun: "bun install --silent",
    npm: "npm install --silent",
    yarn: "yarn install --silent",
    pnpm: "pnpm install --silent",
  };

  const installCmd = installCommands[packageManager];

  logger.info(
    { packageManager, installCmd },
    "[DependencyInstaller] Installing dependencies",
  );

  try {
    const escapedDir = shellEscapeSingleQuotes(repoDir);
    const result = await sandbox.execute(`cd ${escapedDir} && ${installCmd}`, {
      timeout: 300000, // 5 minutes
    });

    if (result.exitCode === 0) {
      logger.info("[DependencyInstaller] Dependencies installed successfully");
      emitProgress(
        "complete",
        `Dependencies installed with ${packageManager}`,
        packageManager,
      );
      return {
        installed: true,
        packageManager,
        output: result.output || "Dependencies installed",
      };
    } else {
      logger.warn(
        { exitCode: result.exitCode, output: result.output },
        "[DependencyInstaller] Dependency installation failed",
      );
      emitProgress(
        "failed",
        `Installation failed with ${packageManager}`,
        packageManager,
      );
      return {
        installed: false,
        packageManager,
        output: result.output || "Installation failed",
      };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(
      { error: errorMsg },
      "[DependencyInstaller] Dependency installation error",
    );
    emitProgress("failed", `Installation error: ${errorMsg}`, packageManager);
    return {
      installed: false,
      packageManager,
      output: errorMsg,
    };
  }
}

/**
 * Format installation results for display.
 */
export function formatInstallationResults(
  result: DependencyInstallerResult,
): string {
  if (result.installed) {
    return `[OK] Dependencies installed using ${result.packageManager}`;
  }

  if (result.packageManager === null) {
    return "[INFO] No package manager detected or dependencies already present";
  }

  return `[WARNING] Dependency installation failed: ${result.output}`;
}
