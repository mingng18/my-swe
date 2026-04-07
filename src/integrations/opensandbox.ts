/**
 * OpenSandbox backend adapter for DeepAgents.
 *
 * Provides isolated container execution environment with:
 * - Shell command execution
 * - File operations (read, write, list, search, delete)
 * - Network policy control
 * - Volume mount support
 */

import { createLogger } from "../utils/logger";
import { randomUUID } from "node:crypto";
import {
  ConnectionConfig,
  Sandbox,
  SandboxException,
} from "@alibaba-group/opensandbox";
import { BaseSandboxBackend } from "./base-sandbox";
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

const logger = createLogger("opensandbox-backend");

export interface OpenSandboxConfig {
  /** Sandbox service domain */
  domain: string;
  /** API key for authentication */
  apiKey: string;
  /** Docker image to use (default: ubuntu:22.04) */
  image?: string;
  /** Timeout in seconds (default: 30 minutes) */
  timeoutSeconds?: number;
  /** CPU limit (default: "2") */
  cpu?: string;
  /** Memory limit (default: "4Gi") */
  memory?: string;
  /** Custom health check function */
  healthCheck?: (sandbox: Sandbox) => Promise<boolean>;
  /** Skip readiness checks */
  skipHealthCheck?: boolean;
}

interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * OpenSandbox backend implementing repo-owned sandbox ports.
 */
export class OpenSandboxBackend extends BaseSandboxBackend {
  private sandbox?: Sandbox;
  private connectionConfig: ConnectionConfig;
  private config: OpenSandboxConfig;
  private _id: string;

  constructor(config: OpenSandboxConfig) {
    super();
    this.config = config;
    this._id = `opensandbox-${Date.now()}-${randomUUID().split("-")[0]}`;
    this.connectionConfig = new ConnectionConfig({
      domain: config.domain,
      apiKey: config.apiKey,
      protocol: "https",
      requestTimeoutSeconds: 60,
    });
  }

  get id(): string {
    return this._id;
  }

  /**
   * Initialize the sandbox instance.
   */
  async initialize(): Promise<void> {
    if (this.sandbox) {
      logger.debug("[opensandbox] Sandbox already initialized");
      return;
    }

    logger.info("[opensandbox] Creating sandbox instance");

    try {
      this.sandbox = await Sandbox.create({
        connectionConfig: this.connectionConfig,
        image: this.config.image || "node:22-bookworm-slim",
        timeoutSeconds: this.config.timeoutSeconds || 30 * 60,
        entrypoint: [
          "sh",
          "-c",
          "apt-get update && apt-get install -y git curl python3 python3-pip && corepack enable && corepack prepare bun@latest --activate && tail -f /dev/null",
        ],
        resource: {
          cpu: this.config.cpu || "2",
          memory: this.config.memory || "4Gi",
        },
        healthCheck: this.config.healthCheck,
        skipHealthCheck: this.config.skipHealthCheck || false,
      });

      logger.info(`[opensandbox] Sandbox created successfully: ${this._id}`);
    } catch (err) {
      if (err instanceof SandboxException) {
        logger.error(
          `[opensandbox] Failed to create sandbox: [${err.error.code}] ${err.error.message ?? ""}`,
        );
        throw new Error(
          `Sandbox creation failed: ${err.error.message || "Unknown error"}`,
        );
      }
      throw err;
    }
  }

  /**
   * Ensure sandbox is initialized before operations.
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.sandbox) {
      await this.initialize();
    }

    // Create directories required by LangSmith experimental sandbox
    // This is needed for tool result storage
    try {
      await this.sandbox!.commands.run("mkdir -p /large_tool_results");
      logger.debug("[opensandbox] Created /large_tool_results directory");
    } catch {
      // Ignore errors, directory might already exist or not be needed
    }
  }

  // ==================== SandboxBackendProtocol ====================

  /**
   * Execute a shell command in the sandbox.
   */
  async execute(command: string): Promise<ExecuteResponse> {
    await this.ensureInitialized();

    logger.debug({ command }, "[opensandbox] Executing command");

    try {
      const execution = await this.sandbox!.commands.run(command);

      const stdout = execution.logs.stdout.reduce((acc, log) => acc + log.text, "");
      const stderr = execution.logs.stderr.reduce((acc, log) => acc + log.text, "");
      const output = stdout + stderr;
      const exitCode = execution.exitCode || 0;

      logger.debug(
        { exitCode, outputLength: output.length },
        "[opensandbox] Command completed",
      );

      return {
        output,
        exitCode,
        truncated: false, // OpenSandbox doesn't report truncation
      };
    } catch (err) {
      logger.error({ error: err }, "[opensandbox] Command execution failed");
      return {
        output: "",
        exitCode: 1,
        truncated: false,
      };
    }
  }

  // ==================== BackendProtocol ====================

  /**
   * Read file content with line numbers.
   */
  async read(
    filePath: string,
    offset: number = 0,
    limit: number = 500,
  ): Promise<string> {
    await this.ensureInitialized();

    logger.debug({ filePath, offset, limit }, "[opensandbox] Reading file");

    try {
      const content = await this.sandbox!.files.readFile(filePath);
      const lines = content.split("\n");

      const startLine = Math.max(0, offset);
      const endLine = Math.min(lines.length, offset + limit);
      const selectedLines = lines.slice(startLine, endLine);

      // Format with line numbers
      const numberedLines = selectedLines
        .map((line, idx) => {
          const lineNum = startLine + idx + 1;
          return `${lineNum}\t${line}`;
        })
        .join("\n");

      return numberedLines;
    } catch (err) {
      logger.error({ error: err, filePath }, "[opensandbox] read failed");
      return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * Read raw file content.
   */
  async readRaw(filePath: string): Promise<FileData> {
    await this.ensureInitialized();

    logger.debug({ filePath }, "[opensandbox] Reading raw file");

    try {
      const content = await this.sandbox!.files.readFile(filePath);
      const lines = content.split("\n");

      return {
        content: lines,
        created_at: new Date().toISOString(),
        modified_at: new Date().toISOString(),
      };
    } catch (err) {
      logger.error({ error: err, filePath }, "[opensandbox] readRaw failed");
      return {
        content: [],
        created_at: new Date().toISOString(),
        modified_at: new Date().toISOString(),
      };
    }
  }

  /**
   * Create/write a file.
   */
  async write(filePath: string, content: string): Promise<WriteResult> {
    await this.ensureInitialized();

    logger.debug(
      { filePath, contentLength: content.length },
      "[opensandbox] Writing file",
    );

    try {
      // Create directory if needed
      const dirPath = filePath.substring(0, filePath.lastIndexOf("/"));
      if (dirPath) {
        await this.sandbox!.files.createDirectories([
          { path: dirPath, mode: 755 },
        ]);
      }

      await this.sandbox!.files.writeFiles([
        { path: filePath, data: content, mode: 644 },
      ]);

      return { path: filePath };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ error: err, filePath }, "[opensandbox] write failed");
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

    logger.debug({ filePath, replaceAll }, "[opensandbox] Editing file");

    try {
      const content = await this.sandbox!.files.readFile(filePath);
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

      await this.sandbox!.files.writeFiles([
        { path: filePath, data: newContent, mode: 644 },
      ]);

      return {
        path: filePath,
        filesUpdate: null, // External storage, already persisted
        occurrences,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ error: err, filePath }, "[opensandbox] edit failed");
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

    logger.debug({ fileCount: files.length }, "[opensandbox] Uploading files");

    const results: Array<{
      path: string;
      error:
        | "file_not_found"
        | "permission_denied"
        | "is_directory"
        | "invalid_path"
        | null;
    }> = [];

    // ⚡ Bolt: Fast path using OpenSandbox SDK batching
    try {
      // 1. Collect all unique directories
      const dirs = new Set<string>();
      for (const [path] of files) {
        const dirPath = path.substring(0, path.lastIndexOf("/"));
        if (dirPath) dirs.add(dirPath);
      }

      // 2. Batch create directories
      if (dirs.size > 0) {
        const dirRequests = Array.from(dirs).map((path) => ({
          path,
          mode: 755,
        }));
        await this.sandbox!.files.createDirectories(dirRequests);
      }

      // 3. Batch write all files
      const writeRequests = files.map(([path, data]) => ({
        path,
        data: new TextDecoder().decode(data),
        mode: 644,
      }));

      if (writeRequests.length > 0) {
        await this.sandbox!.files.writeFiles(writeRequests);
      }

      // If batch succeeds, all files were uploaded successfully
      return files.map(([path]) => ({ path, error: null }));
    } catch (batchErr) {
      logger.debug(
        { error: batchErr },
        "[opensandbox] Batch upload failed, falling back to sequential",
      );

      // Fallback: sequential upload for granular error reporting
      for (const [path, data] of files) {
        try {
          // Create directory if needed
          const dirPath = path.substring(0, path.lastIndexOf("/"));
          if (dirPath) {
            await this.sandbox!.files.createDirectories([
              { path: dirPath, mode: 755 },
            ]);
          }

          // Convert Uint8Array to string
          const content = new TextDecoder().decode(data);
          await this.sandbox!.files.writeFiles([
            { path, data: content, mode: 644 },
          ]);

          results.push({ path, error: null });
        } catch (err) {
          // Map to FileOperationError
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

    logger.debug(
      { pathCount: paths.length },
      "[opensandbox] Downloading files",
    );

    const results: Array<{
      path: string;
      content: Uint8Array | null;
      error:
        | "file_not_found"
        | "permission_denied"
        | "is_directory"
        | "invalid_path"
        | null;
    }> = [];

    // ⚡ Bolt: Chunked parallel downloads to eliminate N+1 sequential bottlenecks.
    // Processes 5 files concurrently. Reduces total download time significantly
    // (e.g. from O(N) network roundtrips to O(N/5)).
    const CONCURRENCY_LIMIT = 5;
    for (let i = 0; i < paths.length; i += CONCURRENCY_LIMIT) {
      const chunk = paths.slice(i, i + CONCURRENCY_LIMIT);
      const chunkResults = await Promise.all(
        chunk.map(async (path) => {
          try {
            const content = await this.sandbox!.files.readFile(path);
            const data = new TextEncoder().encode(content);
            return { path, content: data, error: null };
          } catch (err) {
            // Map to FileOperationError
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
      results.push(...chunkResults);
    }

    return results;
  }

  // ==================== OpenSandbox-specific methods ====================

  /**
   * Get the underlying Sandbox instance.
   */
  getSandbox(): Sandbox | undefined {
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
      const info = await this.sandbox!.getInfo();
      return {
        id: this._id,
        state: info.status.state,
        createdAt: info.createdAt.toISOString(),
        expiresAt: info.expiresAt?.toISOString() || null,
      };
    } catch (err) {
      logger.error({ error: err }, "[opensandbox] getInfo failed");
      return null;
    }
  }

  /**
   * Get sandbox endpoint URL.
   */
  async getEndpointUrl(port: number): Promise<string | null> {
    await this.ensureInitialized();

    try {
      return await this.sandbox!.getEndpointUrl(port);
    } catch (err) {
      logger.error({ error: err }, "[opensandbox] getEndpointUrl failed");
      return null;
    }
  }

  /**
   * Update egress network policy.
   */
  async patchEgressRules(
    rules: Array<{ action: "allow" | "deny"; target: string }>,
  ): Promise<boolean> {
    await this.ensureInitialized();

    try {
      await this.sandbox!.patchEgressRules(rules);
      return true;
    } catch (err) {
      logger.error({ error: err }, "[opensandbox] patchEgressRules failed");
      return false;
    }
  }

  /**
   * Pause the sandbox.
   */
  async pause(): Promise<boolean> {
    if (!this.sandbox) return false;

    try {
      await this.sandbox.pause();
      return true;
    } catch (err) {
      logger.error({ error: err }, "[opensandbox] pause failed");
      return false;
    }
  }

  /**
   * Resume the sandbox.
   */
  async resume(): Promise<OpenSandboxBackend | null> {
    if (!this.sandbox) return null;

    try {
      const resumed = await this.sandbox.resume();
      this.sandbox = resumed;
      return this;
    } catch (err) {
      logger.error({ error: err }, "[opensandbox] resume failed");
      return null;
    }
  }

  /**
   * Renew sandbox timeout.
   */
  async renew(timeoutSeconds: number): Promise<boolean> {
    if (!this.sandbox) return false;

    try {
      await this.sandbox.renew(timeoutSeconds);
      return true;
    } catch (err) {
      logger.error({ error: err }, "[opensandbox] renew failed");
      return false;
    }
  }

  /**
   * Cleanup: terminate and close the sandbox.
   */
  async cleanup(): Promise<void> {
    if (this.sandbox) {
      logger.info("[opensandbox] Cleaning up sandbox");
      try {
        await this.sandbox.kill();
        await this.sandbox.close();
      } catch (err) {
        logger.error({ error: err }, "[opensandbox] cleanup failed");
      }
      this.sandbox = undefined;
    }
  }
}

/**
 * Create an OpenSandbox backend from environment variables.
 */
export function createOpenSandboxBackendFromEnv(): OpenSandboxBackend {
  const domain = process.env.OPENSANDBOX_DOMAIN || "api.opensandbox.io";
  const apiKey = process.env.OPENSANDBOX_API_KEY || "";

  if (!apiKey) {
    throw new Error(
      "OPENSANDBOX_API_KEY is required. Set it in .env or environment.",
    );
  }

  return new OpenSandboxBackend({
    domain,
    apiKey,
    image: process.env.OPENSANDBOX_IMAGE || "ubuntu:22.04",
    timeoutSeconds: parseInt(process.env.OPENSANDBOX_TIMEOUT || "1800", 10),
    cpu: process.env.OPENSANDBOX_CPU || "2",
    memory: process.env.OPENSANDBOX_MEMORY || "4Gi",
  });
}

/**
 * Type guard to check if a backend is OpenSandboxBackend.
 */
export function isOpenSandboxBackend(
  backend: unknown,
): backend is OpenSandboxBackend {
  return (
    typeof backend === "object" &&
    backend !== null &&
    "id" in backend &&
    "execute" in backend &&
    "getSandbox" in backend
  );
}
