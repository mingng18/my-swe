/**
 * Snapshot Manager
 *
 * Handles creation and restoration of sandbox snapshots.
 * Integrates with existing SandboxService for sandbox operations.
 *
 * Key features:
 * - Multi-profile support (Node.js, Python, Java, etc.)
 * - Automatic dependency detection and installation
 * - Diff-based snapshots for efficient storage
 * - Background refresh scheduler
 *
 * References:
 * - Internal enterprise transformation plan (Phase 2)
 */

import { createLogger } from "../utils/logger";
import type { SandboxService } from "../integrations/sandbox-service";
import {
  type SnapshotMetadata,
  type SnapshotKey,
  type SnapshotOptions,
  type SnapshotStore,
  createSnapshotKey,
  getDefaultBranch,
  PROFILE_SETUP_COMMANDS,
  PROFILE_DEPENDENCY_FILES,
  detectProfileFromFiles,
} from "./snapshot-metadata";
import type { SandboxProfile } from "../integrations/daytona-pool";

const logger = createLogger("snapshot-manager");

/**
 * Snapshot creation result.
 */
export interface SnapshotResult {
  success: boolean;
  snapshotId: string;
  metadata: SnapshotMetadata | null;
  error?: string;
}

/**
 * Snapshot restoration result.
 */
export interface RestoreResult {
  success: boolean;
  sandbox: SandboxService | null;
  fromCache: boolean;
  error?: string;
}

/**
 * Snapshot manager handles snapshot lifecycle.
 */
export class SnapshotManager {
  private store: SnapshotStore;
  private pendingRefreshes: Set<string> = new Set();

  constructor(store: SnapshotStore) {
    this.store = store;
  }

  /**
   * Create a snapshot for a repository with the given profile.
   *
   * This process:
   * 1. Clones the repository
   * 2. Detects and installs dependencies
   * 3. Runs profile-specific setup commands
   * 4. Runs optional pre-build step
   * 5. Captures the snapshot (via provider API or checkpoint)
   * 6. Stores metadata
   */
  async createSnapshot(
    sandbox: SandboxService,
    options: SnapshotOptions & {
      repoOwner: string;
      repoName: string;
      githubToken?: string;
    },
  ): Promise<SnapshotResult> {
    const {
      repoOwner,
      repoName,
      profile,
      branch = getDefaultBranch(),
      githubToken,
      runPreBuild = true,
      setupCommands,
      dependencies,
    } = options;

    const key = createSnapshotKey({ repoOwner, repoName, profile, branch });
    const snapshotId = `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    logger.info(
      {
        snapshotId,
        repo: `${repoOwner}/${repoName}`,
        profile,
        branch,
      },
      `[snapshot-manager] Creating snapshot`,
    );

    // Prevent concurrent refreshes of the same snapshot
    const cacheKey = JSON.stringify(key);
    if (this.pendingRefreshes.has(cacheKey)) {
      logger.debug(
        { key },
        `[snapshot-manager] Snapshot already being refreshed`,
      );
      return {
        success: false,
        snapshotId,
        metadata: null,
        error: "Snapshot refresh already in progress",
      };
    }

    this.pendingRefreshes.add(cacheKey);

    try {
      // Clone the repository
      const repoDir = await sandbox.cloneRepo(repoOwner, repoName, githubToken);

      // Get current commit SHA
      const shaResult = await sandbox.execute(
        `cd ${repoDir} && git rev-parse HEAD`,
      );
      const commitSha = shaResult.output.trim();

      // Detect and install dependencies
      const detectedDeps = await this.detectAndInstallDependencies(
        sandbox,
        repoDir,
        profile,
        dependencies,
      );

      // Run profile-specific setup commands
      const allSetupCommands = [
        ...(PROFILE_SETUP_COMMANDS[profile] || []),
        ...(setupCommands || []),
      ];

      for (const cmd of allSetupCommands) {
        try {
          await sandbox.execute(`cd ${repoDir} && ${cmd}`);
        } catch (error) {
          logger.warn(
            { error, cmd },
            `[snapshot-manager] Setup command failed (non-fatal)`,
          );
        }
      }

      // Run optional pre-build
      let preBuildSuccess = true;
      if (runPreBuild) {
        preBuildSuccess = await this.runPreBuild(sandbox, repoDir, profile);
      }

      // Capture snapshot via provider
      const snapshotData = await this.captureSnapshot(sandbox);

      // Calculate size (estimate based on diff or provider info)
      const size = await this.calculateSnapshotSize(
        sandbox,
        repoDir,
        snapshotData,
      );

      const metadata: SnapshotMetadata = {
        snapshotId,
        key,
        createdAt: new Date(),
        refreshedAt: new Date(),
        commitSha,
        dependencies: detectedDeps,
        preBuildSuccess,
        size,
        provider: sandbox.getProvider(),
        image: await this.getImageName(sandbox),
        refreshing: false,
      };

      await this.store.save(metadata);

      logger.info(
        {
          snapshotId,
          repo: `${repoOwner}/${repoName}`,
          profile,
          size,
          dependenciesCount: detectedDeps.length,
        },
        `[snapshot-manager] Snapshot created successfully`,
      );

      return {
        success: true,
        snapshotId,
        metadata,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(
        { error, snapshotId, key },
        `[snapshot-manager] Snapshot creation failed`,
      );

      return {
        success: false,
        snapshotId,
        metadata: null,
        error: errorMsg,
      };
    } finally {
      this.pendingRefreshes.delete(cacheKey);
    }
  }

  /**
   * Restore a sandbox from a snapshot.
   *
   * If a snapshot exists for the given key, restore from it.
   * Otherwise, return a fresh sandbox.
   */
  async restoreSnapshot(
    key: SnapshotKey,
    acquireSandbox: () => Promise<SandboxService>,
  ): Promise<RestoreResult> {
    const metadata = await this.store.get(key);

    if (!metadata) {
      logger.debug(
        { key },
        `[snapshot-manager] No snapshot found, will use fresh sandbox`,
      );
      return {
        success: true,
        sandbox: null,
        fromCache: false,
      };
    }

    logger.info(
      {
        snapshotId: metadata.snapshotId,
        repo: `${key.repoOwner}/${key.repoName}`,
        profile: key.profile,
        age: Date.now() - metadata.refreshedAt.getTime(),
      },
      `[snapshot-manager] Restoring from snapshot`,
    );

    try {
      // For now, we create a fresh sandbox and verify it matches the snapshot metadata
      // In a full implementation with provider snapshot APIs, we would:
      // 1. Call provider's restore API with snapshot ID
      // 2. Verify the restored sandbox is ready

      // TODO: Integrate with provider snapshot APIs when available
      // For OpenSandbox: use their snapshot/checkpoint API
      // For Daytona: use their workspace template API

      logger.debug(
        `[snapshot-manager] Provider snapshot APIs not yet integrated, using fresh sandbox`,
      );

      return {
        success: true,
        sandbox: null,
        fromCache: false,
        error: "Provider snapshot APIs not yet integrated",
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(
        { error, key },
        `[snapshot-manager] Snapshot restoration failed`,
      );

      return {
        success: false,
        sandbox: null,
        fromCache: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Detect and install dependencies for the given profile.
   */
  private async detectAndInstallDependencies(
    sandbox: SandboxService,
    repoDir: string,
    profile: SandboxProfile,
    customDependencies?: string[],
  ): Promise<string[]> {
    const dependencies: string[] = [...(customDependencies || [])];

    // Profile-specific dependency installation
    switch (profile) {
      case "typescript":
      case "javascript": {
        // Check for package.json and run npm install
        const packageJson = await this.readJsonFile<{
          dependencies?: Record<string, string>;
        }>(sandbox, `${repoDir}/package.json`);

        if (packageJson?.dependencies) {
          logger.debug(`[snapshot-manager] Installing Node.js dependencies`);
          try {
            await sandbox.execute(`cd ${repoDir} && npm install --silent`);
            dependencies.push(...Object.keys(packageJson.dependencies));
          } catch (error) {
            logger.warn({ error }, `[snapshot-manager] npm install failed`);
          }
        }
        break;
      }

      case "python": {
        // Check for requirements.txt or pyproject.toml
        const hasRequirementsTxt = await this.fileExists(
          sandbox,
          `${repoDir}/requirements.txt`,
        );
        const hasPyprojectToml = await this.fileExists(
          sandbox,
          `${repoDir}/pyproject.toml`,
        );

        if (hasRequirementsTxt || hasPyprojectToml) {
          logger.debug(`[snapshot-manager] Installing Python dependencies`);
          try {
            if (hasRequirementsTxt) {
              await sandbox.execute(
                `cd ${repoDir} && pip install -r requirements.txt -q`,
              );
            }
            if (hasPyprojectToml) {
              await sandbox.execute(`cd ${repoDir} && pip install -e . -q`);
            }
          } catch (error) {
            logger.warn({ error }, `[snapshot-manager] pip install failed`);
          }
        }
        break;
      }

      case "java": {
        // Check for pom.xml and run Maven
        const hasPomXml = await this.fileExists(sandbox, `${repoDir}/pom.xml`);

        if (hasPomXml) {
          logger.debug(`[snapshot-manager] Installing Java dependencies`);
          try {
            await sandbox.execute(`cd ${repoDir} && mvn dependency:resolve -q`);
          } catch (error) {
            logger.warn({ error }, `[snapshot-manager] Maven resolve failed`);
          }
        }
        break;
      }
    }

    return dependencies;
  }

  /**
   * Run pre-build step if applicable.
   */
  private async runPreBuild(
    sandbox: SandboxService,
    repoDir: string,
    profile: SandboxProfile,
  ): Promise<boolean> {
    switch (profile) {
      case "typescript":
      case "javascript": {
        // Try to run `npm run build` if it exists
        const packageJson = await this.readJsonFile<{
          scripts?: Record<string, string>;
        }>(sandbox, `${repoDir}/package.json`);

        if (packageJson?.scripts?.build) {
          logger.debug(`[snapshot-manager] Running pre-build: npm run build`);
          try {
            const result = await sandbox.execute(
              `cd ${repoDir} && npm run build`,
            );
            return result.exitCode === 0;
          } catch (error) {
            logger.warn({ error }, `[snapshot-manager] Pre-build failed`);
            return false;
          }
        }
        return true;
      }

      case "java": {
        // Try to run Maven compile
        try {
          const result = await sandbox.execute(
            `cd ${repoDir} && mvn compile -q`,
          );
          return result.exitCode === 0;
        } catch (error) {
          logger.warn({ error }, `[snapshot-manager] Maven compile failed`);
          return false;
        }
      }

      default:
        return true;
    }
  }

  /**
   * Capture snapshot via provider API.
   * TODO: Implement provider-specific snapshot APIs.
   */
  private async captureSnapshot(
    sandbox: SandboxService,
  ): Promise<Record<string, unknown>> {
    // TODO: Integrate with OpenSandbox and Daytona snapshot APIs
    // For now, return empty data
    const info = await sandbox.getInfo();
    return {
      sandboxId: sandbox.id,
      provider: sandbox.getProvider(),
      info,
    };
  }

  /**
   * Calculate snapshot size.
   * TODO: Implement actual size calculation via provider API.
   */
  private async calculateSnapshotSize(
    sandbox: SandboxService,
    repoDir: string,
    snapshotData: Record<string, unknown>,
  ): Promise<number> {
    // If the provider specifically reported its snapshot/workspace size in snapshotData, use it.
    if (snapshotData && typeof snapshotData === "object" && snapshotData.info) {
      const info = snapshotData.info as Record<string, unknown>;
      // Example fields we might expect from future provider APIs:
      if (typeof info.sizeBytes === "number") {
        return info.sizeBytes;
      }
      if (typeof info.diskUsage === "number") {
        return info.diskUsage;
      }
    }

    // Fallback: estimate based on repository size if we don't have provider size
    try {
      const result = await sandbox.execute(`du -sb ${repoDir}`);
      if (result.exitCode === 0) {
        const match = result.output.match(/^(\d+)/);
        if (match) {
          // Multiply by a factor to estimate full environment overhead (e.g., node_modules, system deps)
          // A 2x or 3x multiplier is a common heuristic for full container vs source code size
          const repoSize = parseInt(match[1], 10);
          return Math.max(repoSize * 2, 1024 * 1024 * 50); // At least 50MB
        }
      }
    } catch (error) {
      logger.warn(
        { error },
        "[snapshot-manager] Failed to calculate actual snapshot size, falling back to default",
      );
    }

    // Fallback default
    return 1024 * 1024 * 100; // 100 MB default
  }

  /**
   * Get image name from sandbox.
   * TODO: Implement provider-specific image detection.
   */
  private async getImageName(sandbox: SandboxService): Promise<string> {
    // For now, return provider-specific default images
    // In the future, this will query the provider API for actual image info
    const provider = sandbox.getProvider();
    switch (provider) {
      case "daytona":
        return process.env.DAYTONA_IMAGE || "debian:12.9";
      case "opensandbox":
        return process.env.OPENSANDBOX_IMAGE || "debian:12";
      default:
        return "unknown";
    }
  }

  /**
   * Check if a file exists in the sandbox.
   */
  private async fileExists(
    sandbox: SandboxService,
    path: string,
  ): Promise<boolean> {
    try {
      const result = await sandbox.execute(
        `test -f "${path}" && echo "exists"`,
      );
      return result.output.includes("exists");
    } catch {
      return false;
    }
  }

  /**
   * Read and parse a JSON file from the sandbox.
   */
  private async readJsonFile<T>(
    sandbox: SandboxService,
    path: string,
  ): Promise<T | null> {
    try {
      const content = await sandbox.read(path);
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }
}

/**
 * Global snapshot manager instance.
 */
export const globalSnapshotManager = new SnapshotManager(
  // Will be set to globalSnapshotStore after initialization
  null as unknown as SnapshotStore,
);

/**
 * Initialize the snapshot manager.
 */
export async function initializeSnapshotManager(
  store: SnapshotStore,
): Promise<void> {
  (globalSnapshotManager as any).store = store;
}
