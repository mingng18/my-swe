/**
 * Unified Sandbox Service abstraction layer.
 *
 * Provides a common interface for both OpenSandbox and Daytona backends,
 * allowing easy switching between sandbox providers.
 */

import { createLogger } from "../utils/logger";
import type {
  EditResult,
  ExecuteResponse,
  FileData,
  FileInfo,
  FilesystemPort,
  GrepMatch,
  SandboxBackendPort,
  WriteResult,
} from "./sandbox-protocol";
import { OpenSandboxBackend } from "./opensandbox";
import { DaytonaBackend } from "./daytona";

const logger = createLogger("sandbox-service");

export type SandboxProvider = "opensandbox" | "daytona";

export interface SandboxServiceConfig {
  provider: SandboxProvider;
  // OpenSandbox config
  opensandbox?: {
    domain?: string;
    apiKey?: string;
    image?: string;
    timeoutSeconds?: number;
    cpu?: string;
    memory?: string;
  };
  // Daytona config
  daytona?: {
    apiKey?: string;
    apiUrl?: string;
    target?: string;
    sandboxId?: string;
    image?: string;
    cpu?: number;
    memory?: number;
    disk?: number;
    autoStopInterval?: number;
    autoArchiveInterval?: number;
    autoDeleteInterval?: number;
    ephemeral?: boolean;
    labels?: Record<string, string>;
    envVars?: Record<string, string>;
    name?: string;
    language?: "python" | "javascript" | "typescript";
    networkBlockAll?: boolean;
    networkAllowList?: string;
    public?: boolean;
    user?: string;
    volumes?: Array<{ volumeId: string; mountPath: string; subpath?: string }>;
    preserveOnCleanup?: boolean;
  };
}

/**
 * Unified Sandbox Service that abstracts the underlying provider.
 */
export class SandboxService implements FilesystemPort, SandboxBackendPort {
  private backend: OpenSandboxBackend | DaytonaBackend;
  private provider: SandboxProvider;

  private constructor(
    backend: OpenSandboxBackend | DaytonaBackend,
    provider: SandboxProvider,
  ) {
    this.backend = backend;
    this.provider = provider;
  }

  get id(): string {
    return this.backend.id;
  }

  /**
   * Create a SandboxService from environment variables.
   * Reads SANDBOX_PROVIDER env var (defaults to "opensandbox").
   */
  static async createFromEnv(): Promise<SandboxService> {
    const provider = (process.env.SANDBOX_PROVIDER ||
      "opensandbox") as SandboxProvider;

    logger.info(`[sandbox-service] Creating ${provider} backend`);

    let backend: OpenSandboxBackend | DaytonaBackend;

    if (provider === "daytona") {
      backend = SandboxService.createDaytonaBackend();
    } else {
      backend = SandboxService.createOpenSandboxBackend();
    }

    await backend.initialize();

    logger.info(`[sandbox-service] ${provider} backend initialized`);
    return new SandboxService(backend, provider);
  }

  /**
   * Create a SandboxService from explicit config.
   */
  static async create(config: SandboxServiceConfig): Promise<SandboxService> {
    let backend: OpenSandboxBackend | DaytonaBackend;

    if (config.provider === "daytona") {
      backend = SandboxService.createDaytonaBackend(config.daytona);
    } else {
      backend = SandboxService.createOpenSandboxBackend(config.opensandbox);
    }

    await backend.initialize();
    return new SandboxService(backend, config.provider);
  }

  private static createOpenSandboxBackend(config?: {
    domain?: string;
    apiKey?: string;
    image?: string;
    timeoutSeconds?: number;
    cpu?: string;
    memory?: string;
  }): OpenSandboxBackend {
    const { OpenSandboxBackend: OpenSandbox } = require("./opensandbox");

    return new OpenSandbox({
      domain: config?.domain || process.env.OPENSANDBOX_DOMAIN,
      apiKey: config?.apiKey || process.env.OPENSANDBOX_API_KEY || "",
      image: config?.image || process.env.OPENSANDBOX_IMAGE,
      timeoutSeconds:
        config?.timeoutSeconds ||
        parseInt(process.env.OPENSANDBOX_TIMEOUT || "1800", 10),
      cpu: config?.cpu || process.env.OPENSANDBOX_CPU,
      memory: config?.memory || process.env.OPENSANDBOX_MEMORY,
    });
  }

  private static createDaytonaBackend(config?: {
    apiKey?: string;
    apiUrl?: string;
    target?: string;
    sandboxId?: string;
    image?: string;
    cpu?: number;
    memory?: number;
    disk?: number;
    autoStopInterval?: number;
    autoArchiveInterval?: number;
    autoDeleteInterval?: number;
    ephemeral?: boolean;
    labels?: Record<string, string>;
    envVars?: Record<string, string>;
    name?: string;
    language?: "python" | "javascript" | "typescript";
    networkBlockAll?: boolean;
    networkAllowList?: string;
    public?: boolean;
    user?: string;
    volumes?: Array<{ volumeId: string; mountPath: string; subpath?: string }>;
    preserveOnCleanup?: boolean;
  }): DaytonaBackend {
    const { DaytonaBackend: Daytona } = require("./daytona");

    return new Daytona({
      apiKey: config?.apiKey || process.env.DAYTONA_API_KEY || "",
      apiUrl: config?.apiUrl || process.env.DAYTONA_API_URL,
      target: config?.target || process.env.DAYTONA_TARGET,
      sandboxId: config?.sandboxId || process.env.DAYTONA_SANDBOX_ID,
      image: config?.image || process.env.DAYTONA_IMAGE,
      cpu:
        config?.cpu ||
        (process.env.DAYTONA_CPU
          ? parseInt(process.env.DAYTONA_CPU, 10)
          : undefined),
      memory:
        config?.memory ||
        (process.env.DAYTONA_MEMORY
          ? parseInt(process.env.DAYTONA_MEMORY, 10)
          : undefined),
      disk:
        config?.disk ||
        (process.env.DAYTONA_DISK
          ? parseInt(process.env.DAYTONA_DISK, 10)
          : undefined),
      autoStopInterval:
        config?.autoStopInterval ||
        (process.env.DAYTONA_AUTOSTOP
          ? parseInt(process.env.DAYTONA_AUTOSTOP, 10)
          : undefined),
      autoArchiveInterval:
        config?.autoArchiveInterval ||
        (process.env.DAYTONA_AUTOARCHIVE
          ? parseInt(process.env.DAYTONA_AUTOARCHIVE, 10)
          : undefined),
      autoDeleteInterval:
        config?.autoDeleteInterval ||
        (process.env.DAYTONA_AUTODELETE
          ? parseInt(process.env.DAYTONA_AUTODELETE, 10)
          : undefined),
      ephemeral: config?.ephemeral,
      labels: config?.labels,
      envVars: config?.envVars,
      name: config?.name,
      language: config?.language,
      networkBlockAll: config?.networkBlockAll,
      networkAllowList: config?.networkAllowList,
      public: config?.public,
      user: config?.user,
      volumes: config?.volumes,
      preserveOnCleanup: config?.preserveOnCleanup,
    });
  }

  /**
   * Get the underlying backend instance.
   */
  getBackend(): OpenSandboxBackend | DaytonaBackend {
    return this.backend;
  }

  /**
   * Get the current provider name.
   */
  getProvider(): SandboxProvider {
    return this.provider;
  }

  // ==================== SandboxBackendProtocol ====================

  async execute(command: string): Promise<ExecuteResponse> {
    return this.backend.execute(command);
  }

  // ==================== BackendProtocol ====================

  async lsInfo(path: string): Promise<FileInfo[]> {
    return this.backend.lsInfo(path);
  }

  async read(
    filePath: string,
    offset?: number,
    limit?: number,
  ): Promise<string> {
    return this.backend.read(filePath, offset, limit);
  }

  async readRaw(filePath: string): Promise<FileData> {
    return this.backend.readRaw(filePath);
  }

  async grepRaw(
    pattern: string,
    path?: string | null,
    glob?: string | null,
  ): Promise<GrepMatch[] | string> {
    return this.backend.grepRaw(pattern, path, glob);
  }

  async globInfo(pattern: string, path?: string): Promise<FileInfo[]> {
    return this.backend.globInfo(pattern, path);
  }

  async write(filePath: string, content: string): Promise<WriteResult> {
    return this.backend.write(filePath, content);
  }

  async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean,
  ): Promise<EditResult> {
    return this.backend.edit(filePath, oldString, newString, replaceAll);
  }

  async uploadFiles(files: Array<[string, Uint8Array]>): Promise<
    Array<{
      path: string;
      error:
        | "file_not_found"
        | "permission_denied"
        | "is_directory"
        | "invalid_path"
        | null;
    }>
  > {
    return this.backend.uploadFiles(files);
  }

  async downloadFiles(paths: string[]): Promise<
    Array<{
      path: string;
      content: Uint8Array | null;
      error:
        | "file_not_found"
        | "permission_denied"
        | "is_directory"
        | "invalid_path"
        | null;
    }>
  > {
    return this.backend.downloadFiles(paths);
  }

  /**
   * Provider-specific: Get the underlying sandbox instance.
   */
  getSandbox(): any {
    if ("getSandbox" in this.backend) {
      return (this.backend as any).getSandbox();
    }
    return undefined;
  }

  /**
   * Provider-specific: Get sandbox info.
   */
  async getInfo(): Promise<{
    id: string;
    state: string;
    createdAt: string;
    expiresAt: string | null;
  } | null> {
    if ("getInfo" in this.backend) {
      return (this.backend as any).getInfo();
    }
    return null;
  }

  /**
   * Provider-specific: Get endpoint URL for a port.
   */
  async getEndpointUrl(port: number): Promise<string | null> {
    if ("getEndpointUrl" in this.backend) {
      return (this.backend as any).getEndpointUrl(port);
    }
    return null;
  }

  /**
   * Provider-specific: Pause the sandbox.
   */
  async pause(): Promise<boolean> {
    if ("pause" in this.backend) {
      return (this.backend as any).pause();
    }
    return false;
  }

  /**
   * Provider-specific: Resume the sandbox.
   */
  async resume(): Promise<SandboxService | null> {
    if ("resume" in this.backend) {
      const result = await (this.backend as any).resume();
      if (result) {
        return new SandboxService(result, this.provider);
      }
    }
    return null;
  }

  /**
   * Provider-specific: Renew sandbox timeout/activity.
   */
  async renew(timeoutSeconds?: number): Promise<boolean> {
    if ("renew" in this.backend) {
      // Daytona's renew doesn't take parameters
      if (this.provider === "daytona") {
        return (this.backend as DaytonaBackend).renew();
      } else {
        return (this.backend as OpenSandboxBackend).renew(
          timeoutSeconds || 1800,
        );
      }
    }
    return false;
  }

  /**
   * Get the actual working directory of the sandbox.
   * Different providers use different default paths.
   */
  async getWorkDir(): Promise<string> {
    if ("getSandbox" in this.backend) {
      const sandbox = (this.backend as any).getSandbox();
      if (sandbox && typeof sandbox.getWorkDir === "function") {
        return await sandbox.getWorkDir();
      }
    }
    // Fallback to /workspace for local development
    return "/workspace";
  }

  private async ensureGitAvailable(): Promise<void> {
    // Daytona exposes git operations via `sandbox.git` even if `git` isn't installed in the image.
    if (this.provider === "daytona") {
      const sb = this.getSandbox();
      if (sb?.git && typeof sb.git.clone === "function") return;
    }

    const check = await this.execute(`sh -lc 'command -v git >/dev/null 2>&1'`);
    if (check.exitCode === 0) return;

    logger.info(
      `[sandbox-service] git not found; attempting to install inside sandbox`,
    );

    // Debian/Ubuntu
    const apt = await this.execute(
      `sh -lc 'command -v apt-get >/dev/null 2>&1 && (apt-get update -y && apt-get install -y git ca-certificates) || exit 127'`,
    );
    if (apt.exitCode === 0) return;

    // Alpine
    const apk = await this.execute(
      `sh -lc 'command -v apk >/dev/null 2>&1 && (apk add --no-cache git ca-certificates) || exit 127'`,
    );
    if (apk.exitCode === 0) return;

    throw new Error(
      `git is required but was not found and could not be installed automatically (apt-get/apk unavailable).`,
    );
  }

  /**
   * Ensure ripgrep (rg) is available; if not, install it silently.
   * Also adds a grep alias in ~/.bashrc so raw grep calls benefit from rg.
   */
  private async setupRipgrep(): Promise<void> {
    // Install ripgrep if absent. Best-effort: never throws.
    const cmd =
      "command -v rg > /dev/null 2>&1" +
      " || (apt-get install -y ripgrep > /dev/null 2>&1" +
      " || apk add --no-cache ripgrep > /dev/null 2>&1" +
      " || true)";
    await this.execute(`sh -c '${cmd}' 2>/dev/null || true`).catch(() => {
      logger.warn("[sandbox-service] ripgrep setup failed (best-effort)");
    });
  }

  /**
   * Clone a GitHub repository into the sandbox workspace.
   * If the repo already exists, pulls the latest changes instead.
   * @param repoOwner - Repository owner (e.g., "facebook")
   * @param repoName - Repository name (e.g., "react")
   * @param githubToken - Optional GitHub token for private repos
   * @returns The directory where the repo is located
   */
  async cloneRepo(
    repoOwner: string,
    repoName: string,
    githubToken?: string,
  ): Promise<string> {
    const workDir = await this.getWorkDir();
    const repoDir = `${workDir}/${repoName}`;
    const cloneUrl = `https://github.com/${repoOwner}/${repoName}.git`;

    // Daytona: prefer toolbox-backed Git operations (no `git` binary required).
    if (this.provider === "daytona") {
      const sb = this.getSandbox();
      if (sb?.git && typeof sb.git.clone === "function") {
        // Ensure the workDir exists (some images default to /root, others to /workspace).
        await this.execute(`mkdir -p "${workDir}"`);

        const relPath = repoName; // relative to sandbox workdir per Daytona docs

        // Check if repo already exists
        const checkResult = await this.execute(
          `test -d "${repoDir}/.git" && echo "exists" || echo "not_found"`,
        );

        if (checkResult.output.includes("exists")) {
          logger.info(
            `[sandbox-service] Repo ${repoOwner}/${repoName} already exists at ${repoDir}, pulling latest changes (Daytona git toolbox)`,
          );

          try {
            const status = await sb.git.status(relPath);
            if (typeof status?.behind === "number" && status.behind > 0) {
              if (githubToken) {
                await sb.git.pull(relPath, "git", githubToken);
              } else {
                await sb.git.pull(relPath);
              }
            }
          } catch (err) {
            logger.warn(
              { error: err },
              "[sandbox-service] Daytona git status/pull failed; continuing",
            );
          }

          logger.info(`[sandbox-service] Repo updated successfully at ${repoDir}`);
          await this.setupRipgrep();
          return repoDir;
        }

        logger.info(
          `[sandbox-service] Cloning ${repoOwner}/${repoName} to ${repoDir} (Daytona git toolbox)`,
        );

        if (githubToken) {
          await sb.git.clone(cloneUrl, relPath, undefined, undefined, "git", githubToken);
        } else {
          await sb.git.clone(cloneUrl, relPath);
        }

        // Configure git user for commits (best-effort; uses shell if git exists, otherwise noop)
        await this.execute(
          `cd "${repoDir}" && git config user.name "open-swe[bot]" 2>/dev/null || true`,
        );
        await this.execute(
          `cd "${repoDir}" && git config user.email "open-swe@users.noreply.github.com" 2>/dev/null || true`,
        );

        logger.info(`[sandbox-service] Repo cloned successfully to ${repoDir}`);
        await this.setupRipgrep();
        return repoDir;
      }
    }

    // Non-Daytona / fallback: ensure `git` binary exists.
    await this.ensureGitAvailable();
    const cloneUrlWithCreds = githubToken
      ? `https://${githubToken}@github.com/${repoOwner}/${repoName}.git`
      : cloneUrl;

    // Ensure workspace directory exists
    await this.execute(`mkdir -p ${workDir}`);

    // Check if repo already exists
    const checkResult = await this.execute(
      `test -d "${repoDir}/.git" && echo "exists" || echo "not_found"`,
    );

    if (checkResult.output.includes("exists")) {
      logger.info(
        `[sandbox-service] Repo ${repoOwner}/${repoName} already exists at ${repoDir}, pulling latest changes`,
      );

      // Fetch and pull latest changes
      const fetchResult = await this.execute(
        `cd "${repoDir}" && git fetch origin 2>&1`,
      );
      if (fetchResult.exitCode !== 0) {
        logger.warn(
          `[sandbox-service] Git fetch failed, continuing: ${fetchResult.output}`,
        );
      }

      // Reset to the repo's default branch.
      // Primary approach: read remote HEAD branch (origin/HEAD -> origin/<branch>).
      // Fallback: try origin/main then origin/master.
      const remoteHead = await this.execute(
        `cd "${repoDir}" && git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || true`,
      );

      const remoteHeadStr = (remoteHead.output || "").trim();
      const defaultBranch = remoteHeadStr.startsWith("origin/")
        ? remoteHeadStr.slice("origin/".length)
        : "";

      let resetAttempt: { branch: string; res: typeof fetchResult } | null =
        null;

      if (defaultBranch) {
        resetAttempt = {
          branch: defaultBranch,
          res: await this.execute(
            `cd "${repoDir}" && git reset --hard "origin/${defaultBranch}" 2>&1`,
          ),
        };
      }

      if (!resetAttempt || resetAttempt.res.exitCode !== 0) {
        const mainRes = await this.execute(
          `cd "${repoDir}" && git reset --hard origin/main 2>&1`,
        );
        if (mainRes.exitCode === 0) {
          logger.info(
            `[sandbox-service] Reset to origin/main for ${repoOwner}/${repoName}`,
          );
        } else {
          const masterRes = await this.execute(
            `cd "${repoDir}" && git reset --hard origin/master 2>&1`,
          );
          if (masterRes.exitCode === 0) {
            logger.info(
              `[sandbox-service] Reset to origin/master for ${repoOwner}/${repoName}`,
            );
          } else {
            logger.warn(
              `[sandbox-service] Git reset failed (default=${defaultBranch || "unknown"}), continuing: ${masterRes.output || mainRes.output}`,
            );
          }
        }
      }

      logger.info(`[sandbox-service] Repo updated successfully at ${repoDir}`);
    } else {
      logger.info(
        `[sandbox-service] Cloning ${repoOwner}/${repoName} to ${repoDir}`,
      );

      // Clone the repository
      const result = await this.execute(
        `git clone ${cloneUrlWithCreds} ${repoDir} 2>&1`,
      );

      if (result.exitCode !== 0) {
        throw new Error(`Failed to clone repo: ${result.output}`);
      }

      // Configure git user for commits
      await this.execute(
        `cd "${repoDir}" && git config user.name "open-swe[bot]"`,
      );
      await this.execute(
        `cd "${repoDir}" && git config user.email "open-swe@users.noreply.github.com"`,
      );

      logger.info(`[sandbox-service] Repo cloned successfully to ${repoDir}`);
    }

    logger.info(`[sandbox-service] Repo ready at ${repoDir}`);
    await this.setupRipgrep();
    return repoDir;
  }

  /**
   * Get the workspace directory for a repo.
   */
  getWorkspaceDir(repoName: string): string {
    return `/workspace/${repoName}`;
  }

  /**
   * Cleanup: terminate and close the sandbox.
   */
  async cleanup(): Promise<void> {
    logger.info(`[sandbox-service] Cleaning up ${this.provider} backend`);
    return this.backend.cleanup();
  }

  /**
   * Check if the backend is an OpenSandbox backend.
   */
  isOpenSandbox(): this is SandboxService & { backend: OpenSandboxBackend } {
    return this.provider === "opensandbox";
  }

  /**
   * Check if the backend is a Daytona backend.
   */
  isDaytona(): this is SandboxService & { backend: DaytonaBackend } {
    return this.provider === "daytona";
  }
}

/**
 * Create a SandboxService from environment variables.
 * Convenience function for the most common use case.
 */
export async function createSandboxService(): Promise<SandboxService> {
  return SandboxService.createFromEnv();
}

/**
 * Create a SandboxService with explicit provider configuration.
 */
export async function createSandboxServiceWithConfig(
  config: SandboxServiceConfig,
): Promise<SandboxService> {
  return SandboxService.create(config);
}

// Re-export types for convenience
export type { OpenSandboxBackend } from "./opensandbox";
export type { DaytonaBackend } from "./daytona";
export type { OpenSandboxConfig } from "./opensandbox";
export type { DaytonaConfig } from "./daytona";
