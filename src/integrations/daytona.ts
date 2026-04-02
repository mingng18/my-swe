/**
 * Daytona backend adapter for DeepAgents.
 *
 * Provides isolated container execution environment using Daytona sandboxes with:
 * - Shell command execution
 * - File operations (read, write, list, search, delete)
 * - Network policy control
 * - Volume mount support
 */

import { createLogger } from "../utils/logger";
import { Daytona } from "@daytonaio/sdk";
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

const logger = createLogger("daytona-backend");

export interface DaytonaConfig {
  /** Daytona API key */
  apiKey: string;
  /** Daytona API URL (optional, defaults to https://app.daytona.io/api) */
  apiUrl?: string;
  /** Target environment for sandboxes */
  target?: string;
  /** Docker image to use (default: debian:12.9) */
  image?: string;
  /** CPU allocation in cores */
  cpu?: number;
  /** Memory allocation in GiB */
  memory?: number;
  /** Disk allocation in GiB */
  disk?: number;
  /** Environment variables to set in the sandbox */
  envVars?: Record<string, string>;
  /** Auto-stop interval in minutes (0 means disabled) */
  autoStopInterval?: number;
  /** Auto-archive interval in minutes (0 uses Daytona maximum; default is 7 days) */
  autoArchiveInterval?: number;
  /** Auto-delete interval in minutes (negative disables; 0 deletes immediately on stop) */
  autoDeleteInterval?: number;
  /** Whether the Sandbox should be ephemeral (autoDeleteInterval will be set to 0) */
  ephemeral?: boolean;
  /** Sandbox labels */
  labels?: Record<string, string>;
  /** Sandbox name */
  name?: string;
  /** Programming language for direct code execution */
  language?: "python" | "javascript" | "typescript";
  /** Whether to block all network access for the Sandbox */
  networkBlockAll?: boolean;
  /** Comma-separated list of allowed CIDR network addresses for the Sandbox */
  networkAllowList?: string;
  /** Is the Sandbox port preview public */
  public?: boolean;
  /** Optional OS user to use for the Sandbox */
  user?: string;
  /** Optional array of volumes to mount to the Sandbox */
  volumes?: Array<{ volumeId: string; mountPath: string; subpath?: string }>;
  /** Reuse existing sandbox by ID (if provided, no new sandbox will be created) */
  sandboxId?: string;
  /**
   * Preserve the sandbox when cleaning up.
   * When true, `cleanup()` disposes the client but does NOT delete the sandbox.
   * This is required for sandbox pooling/reuse.
   */
  preserveOnCleanup?: boolean;
}

/**
 * Daytona backend implementing repo-owned sandbox ports.
 */
export class DaytonaBackend implements FilesystemPort, SandboxBackendPort {
  private daytona: Daytona;
  private sandbox?: Awaited<ReturnType<typeof this.daytona.create>>;
  private config: DaytonaConfig;
  private _id: string;

  constructor(config: DaytonaConfig) {
    this.config = config;
    this._id = `daytona-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    this.daytona = new Daytona({
      apiKey: config.apiKey,
      apiUrl: config.apiUrl,
      target: config.target,
    });
  }

  get id(): string {
    return this._id;
  }

  /**
   * Initialize the Daytona sandbox instance.
   */
  async initialize(): Promise<void> {
    if (this.sandbox) {
      logger.debug("[daytona] Sandbox already initialized");
      return;
    }

    // If sandboxId is provided, reuse existing sandbox
    if (this.config.sandboxId) {
      logger.info(
        `[daytona] Reusing existing sandbox: ${this.config.sandboxId}`,
      );
      try {
        // Get the existing sandbox (throws if missing/unauthorized)
        const existing = await this.daytona.get(this.config.sandboxId);
        this.sandbox = existing;
        this._id = existing.id;

        // Ensure it's started
        if (existing.state !== "started") {
          logger.info(`[daytona] Starting existing sandbox: ${existing.id}`);
          await existing.waitUntilStarted(120);
        }

        // Create directories required by LangSmith experimental sandbox
        await existing.process.executeCommand(
          "mkdir -p /large_tool_results 2>/dev/null || true",
        );

        logger.info(
          `[daytona] Reused sandbox successfully: ${this.sandbox.id} (${this.sandbox.state})`,
        );
        return;
      } catch (err) {
        logger.error(
          { error: err },
          "[daytona] Failed to reuse sandbox, creating new one",
        );
      }
    }

    logger.info("[daytona] Creating new sandbox instance");

    try {
      const image = this.config.image || "debian:12.9";

      const resources =
        this.config.cpu || this.config.memory || this.config.disk
          ? {
              cpu: this.config.cpu,
              memory: this.config.memory,
              disk: this.config.disk,
            }
          : undefined;

      const createParams: Record<string, unknown> = {
        image,
        language: this.config.language,
        name: this.config.name,
        labels: this.config.labels,
        envVars: this.config.envVars,
        resources,
        autoStopInterval: this.config.autoStopInterval,
        autoArchiveInterval: this.config.autoArchiveInterval,
        autoDeleteInterval: this.config.autoDeleteInterval,
        ephemeral: this.config.ephemeral,
        networkBlockAll: this.config.networkBlockAll,
        networkAllowList: this.config.networkAllowList,
        public: this.config.public,
        user: this.config.user,
        volumes: this.config.volumes,
      };

      // Remove undefined keys so the SDK only receives explicit params.
      for (const [k, v] of Object.entries(createParams)) {
        if (v === undefined) delete createParams[k];
      }

      const hasEnvVars = Object.keys(this.config.envVars ?? {}).length > 0;
      const hasLabels = Object.keys(this.config.labels ?? {}).length > 0;

      logger.info(
        {
          image,
          language: this.config.language,
          hasEnvVars,
          hasLabels,
          resources,
        },
        "[daytona] Creating sandbox with params",
      );

      // Creates a snapshot from the provided image and then creates the Sandbox.
      this.sandbox = await this.daytona.create(createParams as any);
      this._id = this.sandbox.id;

      logger.info(
        `[daytona] Sandbox created successfully: ${this.sandbox.id} (${this.sandbox.state})`,
      );

      // Log the sandbox ID for reuse
      logger.info(
        `[daytona] To reuse this sandbox, set DAYTONA_SANDBOX_ID=${this.sandbox.id} in .env`,
      );
    } catch (err) {
      logger.error({ error: err }, "[daytona] Failed to create sandbox");
      throw new Error(
        `Daytona sandbox creation failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Ensure sandbox is initialized before operations.
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.sandbox) {
      await this.initialize();
    }

    // Ensure sandbox is in started state
    if (this.sandbox?.state !== "started") {
      await this.sandbox?.waitUntilStarted(120);
    }

    // Create directories required by LangSmith experimental sandbox
    // This is needed for tool result storage
    const dirResult = await this.sandbox!.process.executeCommand(
      "mkdir -p /large_tool_results 2>/dev/null || true",
    );
    if (dirResult.exitCode === 0) {
      logger.debug("[daytona] Created /large_tool_results directory");
    }
  }

  // ==================== SandboxBackendProtocol ====================

  /**
   * Execute a shell command in the Daytona sandbox.
   */
  async execute(command: string): Promise<ExecuteResponse> {
    await this.ensureInitialized();

    logger.debug({ command }, "[daytona] Executing command");

    try {
      const result = await this.sandbox!.process.executeCommand(command);

      logger.debug(
        { exitCode: result.exitCode, outputLength: result.result?.length },
        "[daytona] Command completed",
      );

      return {
        output: result.result || "",
        exitCode: result.exitCode || 0,
        truncated: false,
      };
    } catch (err) {
      logger.error({ error: err }, "[daytona] Command execution failed");
      return {
        output: "",
        exitCode: 1,
        truncated: false,
      };
    }
  }

  // ==================== BackendProtocol ====================

  /**
   * List files and directories in a directory (non-recursive).
   */
  async lsInfo(path: string): Promise<FileInfo[]> {
    await this.ensureInitialized();

    logger.debug({ path }, "[daytona] Listing directory");

    try {
      const result = await this.sandbox!.process.executeCommand(
        `ls -la --time-style=long-iso "${path}"`,
      );
      if (result.exitCode !== 0) {
        return [];
      }

      const lines = (result.result || "").split("\n").slice(1); // Skip header
      const files: FileInfo[] = [];

      for (const line of lines) {
        if (!line.trim()) continue;

        // Parse ls -la output
        const parts = line.split(/\s+/);
        if (parts.length < 8) continue;

        const isDir = parts[0].startsWith("d");
        const fileName = parts.slice(8).join(" ");

        files.push({
          path: isDir ? `${fileName}/` : fileName,
          is_dir: isDir,
        });
      }

      return files;
    } catch (err) {
      logger.error({ error: err, path }, "[daytona] lsInfo failed");
      return [];
    }
  }

  /**
   * Read file content with line numbers.
   */
  async read(
    filePath: string,
    offset: number = 0,
    limit: number = 500,
  ): Promise<string> {
    await this.ensureInitialized();

    logger.debug({ filePath, offset, limit }, "[daytona] Reading file");

    try {
      const buffer = await this.sandbox!.fs.downloadFile(filePath);
      const content = buffer.toString("utf-8");
      const lines = content.split("\n");

      const startLine = Math.max(0, offset);
      const endLine = Math.min(lines.length, offset + limit);
      const selectedLines = lines.slice(startLine, endLine);

      // Format with line numbers
      const numberedLines = selectedLines
        .map((line: string, idx: number) => {
          const lineNum = startLine + idx + 1;
          return `${lineNum}\t${line}`;
        })
        .join("\n");

      return numberedLines;
    } catch (err) {
      logger.error({ error: err, filePath }, "[daytona] read failed");
      return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * Read raw file content.
   */
  async readRaw(filePath: string): Promise<FileData> {
    await this.ensureInitialized();

    logger.debug({ filePath }, "[daytona] Reading raw file");

    try {
      const buffer = await this.sandbox!.fs.downloadFile(filePath);
      const content = buffer.toString("utf-8");
      const lines = content.split("\n");

      return {
        content: lines,
        created_at: new Date().toISOString(),
        modified_at: new Date().toISOString(),
      };
    } catch (err) {
      logger.error({ error: err, filePath }, "[daytona] readRaw failed");
      return {
        content: [],
        created_at: new Date().toISOString(),
        modified_at: new Date().toISOString(),
      };
    }
  }

  /**
   * Search file contents for a regex pattern.
   */
  async grepRaw(
    pattern: string,
    path: string | null = null,
    glob: string | null = null,
  ): Promise<GrepMatch[] | string> {
    await this.ensureInitialized();

    const searchPath =
      path || (await this.sandbox!.getWorkDir()) || "/workspace";
    logger.debug({ pattern, path, glob }, "[daytona] Searching files");

    try {
      // Build grep command
      let cmd = `grep -rn --exclude-dir=node_modules "${pattern}" "${searchPath}"`;
      if (glob) {
        cmd = `find "${searchPath}" -name "${glob}" -exec grep -Hn "${pattern}" {} +`;
      }

      const result = await this.sandbox!.process.executeCommand(cmd);
      if (result.exitCode !== 0 && result.exitCode !== 1) {
        return `Search error: ${result.result || ""}`;
      }

      const matches: GrepMatch[] = [];
      for (const line of (result.result || "").split("\n")) {
        if (!line.trim()) continue;

        // Parse grep output: "file:line:content"
        const colonIdx = line.indexOf(":");
        if (colonIdx === -1) continue;

        const filePath = line.substring(0, colonIdx);
        const rest = line.substring(colonIdx + 1);
        const secondColonIdx = rest.indexOf(":");
        if (secondColonIdx === -1) continue;

        const lineNum = parseInt(rest.substring(0, secondColonIdx), 10);
        const text = rest.substring(secondColonIdx + 1);

        matches.push({
          path: filePath,
          line: lineNum,
          text,
        });
      }

      return matches;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return `Search failed: ${errorMsg}`;
    }
  }

  /**
   * Glob pattern matching.
   */
  async globInfo(pattern: string, path: string = "/"): Promise<FileInfo[]> {
    await this.ensureInitialized();

    logger.debug({ pattern, path }, "[daytona] Glob search");

    try {
      // Use find command for glob matching
      const result = await this.sandbox!.process.executeCommand(
        `find "${path}" -name "${pattern}" -type f`,
      );
      if (result.exitCode !== 0) {
        return [];
      }

      const files: FileInfo[] = [];
      for (const line of (result.result || "").split("\n")) {
        if (!line.trim()) continue;
        files.push({ path: line.trim(), is_dir: false });
      }

      return files;
    } catch (err) {
      logger.error({ error: err, pattern, path }, "[daytona] globInfo failed");
      return [];
    }
  }

  /**
   * Create/write a file.
   */
  async write(filePath: string, content: string): Promise<WriteResult> {
    await this.ensureInitialized();

    logger.debug(
      { filePath, contentLength: content.length },
      "[daytona] Writing file",
    );

    try {
      const buffer = Buffer.from(content, "utf-8");
      await this.sandbox!.fs.uploadFile(buffer, filePath);
      return { path: filePath };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ error: err, filePath }, "[daytona] write failed");
      return { error: errorMsg };
    }
  }

  /**
   * Edit a file by replacing string occurrences.
   */
  async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll: boolean = false,
  ): Promise<EditResult> {
    await this.ensureInitialized();

    logger.debug({ filePath, replaceAll }, "[daytona] Editing file");

    try {
      const buffer = await this.sandbox!.fs.downloadFile(filePath);
      const content = buffer.toString("utf-8");
      let newContent: string;
      let occurrences = 0;

      if (replaceAll) {
        occurrences = (content.match(new RegExp(oldString, "g")) || []).length;
        newContent = content.split(oldString).join(newString);
      } else {
        const idx = content.indexOf(oldString);
        if (idx === -1) {
          return { error: "Old string not found in file" };
        }
        occurrences = 1;
        newContent =
          content.substring(0, idx) +
          newString +
          content.substring(idx + oldString.length);
      }

      const newBuffer = Buffer.from(newContent, "utf-8");
      await this.sandbox!.fs.uploadFile(newBuffer, filePath);

      return {
        path: filePath,
        filesUpdate: null,
        occurrences,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ error: err, filePath }, "[daytona] edit failed");
      return { error: errorMsg };
    }
  }

  /**
   * Upload multiple files.
   */
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
    await this.ensureInitialized();

    logger.debug({ fileCount: files.length }, "[daytona] Uploading files");

    const results: Array<{
      path: string;
      error:
        | "file_not_found"
        | "permission_denied"
        | "is_directory"
        | "invalid_path"
        | null;
    }> = [];

    for (const [path, data] of files) {
      try {
        // Convert Uint8Array to Buffer
        const buffer = Buffer.from(data);
        await this.sandbox!.fs.uploadFile(buffer, path);
        results.push({ path, error: null });
      } catch (err) {
        const error:
          | "file_not_found"
          | "permission_denied"
          | "is_directory"
          | "invalid_path" =
          err instanceof Error && err.message.includes("not found")
            ? "file_not_found"
            : err instanceof Error && err.message.includes("permission")
              ? "permission_denied"
              : "invalid_path";
        results.push({ path, error });
      }
    }

    return results;
  }

  /**
   * Download multiple files.
   */
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
    await this.ensureInitialized();

    logger.debug({ pathCount: paths.length }, "[daytona] Downloading files");

    const results = await Promise.all(
      paths.map(async (path) => {
        try {
          const buffer = await this.sandbox!.fs.downloadFile(path);
          const data = new Uint8Array(buffer);
          return { path, content: data, error: null };
        } catch (err) {
          const error:
            | "file_not_found"
            | "permission_denied"
            | "is_directory"
            | "invalid_path" =
            err instanceof Error && err.message.includes("not found")
              ? "file_not_found"
              : err instanceof Error && err.message.includes("permission")
                ? "permission_denied"
                : "invalid_path";
          return { path, content: null, error };
        }
      }),
    );

    return results;
  }

  // ==================== Daytona-specific methods ====================

  /**
   * Get the underlying Daytona Sandbox instance.
   */
  getSandbox(): typeof this.sandbox {
    return this.sandbox;
  }

  /**
   * Get sandbox info.
   */
  async getInfo(): Promise<{
    id: string;
    state: string;
    createdAt: string;
    expiresAt: string | null;
  } | null> {
    await this.ensureInitialized();

    try {
      await this.sandbox!.refreshData();
      return {
        id: this.sandbox!.id,
        state: this.sandbox!.state || "unknown",
        createdAt: this.sandbox!.createdAt || new Date().toISOString(),
        expiresAt: null,
      };
    } catch (err) {
      logger.error({ error: err }, "[daytona] getInfo failed");
      return null;
    }
  }

  /**
   * Get preview link for a port.
   */
  async getEndpointUrl(port: number): Promise<string | null> {
    await this.ensureInitialized();

    try {
      const preview = await this.sandbox!.getPreviewLink(port);
      return preview.url;
    } catch (err) {
      logger.error({ error: err }, "[daytona] getPreviewLink failed");
      return null;
    }
  }

  /**
   * Pause/stop the sandbox.
   */
  async pause(): Promise<boolean> {
    if (!this.sandbox) return false;

    try {
      await this.sandbox.stop();
      return true;
    } catch (err) {
      logger.error({ error: err }, "[daytona] pause failed");
      return false;
    }
  }

  /**
   * Resume/start the sandbox.
   */
  async resume(): Promise<DaytonaBackend | null> {
    if (!this.sandbox) return null;

    try {
      await this.daytona.start(this.sandbox);
      return this;
    } catch (err) {
      logger.error({ error: err }, "[daytona] resume failed");
      return null;
    }
  }

  /**
   * Renew sandbox by refreshing activity.
   */
  async renew(): Promise<boolean> {
    if (!this.sandbox) return false;

    try {
      await this.sandbox.refreshActivity();
      return true;
    } catch (err) {
      logger.error({ error: err }, "[daytona] renew failed");
      return false;
    }
  }

  /**
   * Cleanup: terminate and close the sandbox.
   */
  async cleanup(): Promise<void> {
    if (this.sandbox) {
      logger.info("[daytona] Cleaning up sandbox");
      try {
        if (!this.config.preserveOnCleanup) {
          await this.daytona.delete(this.sandbox, 60);
        } else {
          // For pooled sandboxes, we keep them around for reuse.
          // Callers should manage lifecycle via labels + autoStop/autoArchive/autoDelete.
          logger.info(
            `[daytona] preserveOnCleanup=true; not deleting sandbox ${this.sandbox.id}`,
          );
        }
      } catch (err) {
        logger.error({ error: err }, "[daytona] cleanup failed");
      }
      this.sandbox = undefined;
    }

    try {
      await this.daytona[Symbol.asyncDispose]();
    } catch (err) {
      logger.error(
        { error: err },
        "[daytona] failed to dispose Daytona client",
      );
    }
  }
}

/**
 * Create a Daytona backend from environment variables.
 */
export function createDaytonaBackendFromEnv(): DaytonaBackend {
  const apiKey = process.env.DAYTONA_API_KEY || "";

  if (!apiKey) {
    throw new Error(
      "DAYTONA_API_KEY is required. Set it in .env or environment.",
    );
  }

  const parseBoolean = (value: string | undefined): boolean | undefined => {
    if (value === undefined) return undefined;
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1" || v === "yes") return true;
    if (v === "false" || v === "0" || v === "no") return false;
    return undefined;
  };

  const parseJsonRecord = (
    value: string | undefined,
  ): Record<string, string> | undefined => {
    if (!value) return undefined;
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== "object") return undefined;
      const rec: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") rec[k] = v;
        else if (v != null) rec[k] = String(v);
      }
      return rec;
    } catch {
      return undefined;
    }
  };

  const languageEnv = process.env.DAYTONA_LANGUAGE?.trim().toLowerCase();
  const language =
    languageEnv === "typescript" ||
    languageEnv === "javascript" ||
    languageEnv === "python"
      ? (languageEnv as "typescript" | "javascript" | "python")
      : undefined;

  return new DaytonaBackend({
    apiKey,
    apiUrl: process.env.DAYTONA_API_URL,
    target: process.env.DAYTONA_TARGET,
    sandboxId: process.env.DAYTONA_SANDBOX_ID,
    image: process.env.DAYTONA_IMAGE || "debian:12.9",
    cpu: process.env.DAYTONA_CPU ? parseInt(process.env.DAYTONA_CPU, 10) : 2,
    memory: process.env.DAYTONA_MEMORY
      ? parseInt(process.env.DAYTONA_MEMORY, 10)
      : 4,
    disk: process.env.DAYTONA_DISK
      ? parseInt(process.env.DAYTONA_DISK, 10)
      : 20,
    autoStopInterval: process.env.DAYTONA_AUTOSTOP
      ? parseInt(process.env.DAYTONA_AUTOSTOP, 10)
      : 0,
    autoArchiveInterval: process.env.DAYTONA_AUTOARCHIVE
      ? parseInt(process.env.DAYTONA_AUTOARCHIVE, 10)
      : undefined,
    autoDeleteInterval: process.env.DAYTONA_AUTODELETE
      ? parseInt(process.env.DAYTONA_AUTODELETE, 10)
      : undefined,
    ephemeral: parseBoolean(process.env.DAYTONA_EPHEMERAL),
    networkBlockAll: parseBoolean(process.env.DAYTONA_NETWORK_BLOCK_ALL),
    networkAllowList: process.env.DAYTONA_NETWORK_ALLOW_LIST,
    public: parseBoolean(process.env.DAYTONA_PUBLIC),
    user: process.env.DAYTONA_USER,
    name: process.env.DAYTONA_NAME,
    language,
    labels: parseJsonRecord(process.env.DAYTONA_LABELS_JSON),
    envVars: parseJsonRecord(process.env.DAYTONA_ENV_VARS_JSON),
  });
}

/**
 * Type guard to check if a backend is DaytonaBackend.
 */
export function isDaytonaBackend(backend: unknown): backend is DaytonaBackend {
  return (
    typeof backend === "object" &&
    backend !== null &&
    "id" in backend &&
    "execute" in backend &&
    "getSandbox" in backend
  );
}
