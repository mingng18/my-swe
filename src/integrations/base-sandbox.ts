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

const logger = createLogger("sandbox-backend");

/**
 * Abstract base class for sandbox backends.
 * Provides common implementations for filesystem operations that rely on shell commands.
 */
export abstract class BaseSandboxBackend implements SandboxBackendPort, FilesystemPort {
  // Required implementation from SandboxBackendPort
  abstract execute(command: string): Promise<ExecuteResponse>;

  // Required implementations from FilesystemPort for native file operations
  abstract read(filePath: string, offset?: number, limit?: number): Promise<string>;
  abstract readRaw(filePath: string): Promise<FileData>;
  abstract write(filePath: string, content: string): Promise<WriteResult>;
  abstract edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean,
  ): Promise<EditResult>;
  abstract uploadFiles(
    files: Array<[string, Uint8Array]>,
  ): Promise<
    Array<{
      path: string;
      error:
        | "file_not_found"
        | "permission_denied"
        | "is_directory"
        | "invalid_path"
        | null;
    }>
  >;
  abstract downloadFiles(
    paths: string[],
  ): Promise<
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
  >;

  /**
   * Get the working directory of the sandbox.
   * Can be overridden by subclasses if needed.
   */
  async getWorkDir(): Promise<string> {
    return "/workspace";
  }

  /**
   * List files and directories in a directory (non-recursive).
   */
  async lsInfo(path: string): Promise<FileInfo[]> {
    logger.debug({ path }, "[sandbox] Listing directory");

    try {
      const result = await this.execute(`ls -la --time-style=long-iso "${path}"`);
      if (result.exitCode !== 0) {
        return [];
      }

      const lines = result.output.split("\n").slice(1); // Skip header
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
      logger.error({ error: err, path }, "[sandbox] lsInfo failed");
      return [];
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
    const searchPath = path || (await this.getWorkDir());
    logger.debug({ pattern, path, glob }, "[sandbox] Searching files");

    try {
      // Build grep command
      let cmd = `grep -rn --exclude-dir=node_modules "${pattern}" "${searchPath}"`;
      if (glob) {
        cmd = `find "${searchPath}" -name "${glob}" -exec grep -Hn "${pattern}" {} +`;
      }

      const result = await this.execute(cmd);
      if (result.exitCode !== 0 && result.exitCode !== 1) {
        return `Search error: ${result.output}`;
      }

      const matches: GrepMatch[] = [];
      for (const line of result.output.split("\n")) {
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
    logger.debug({ pattern, path }, "[sandbox] Glob search");

    try {
      // Use find command for glob matching
      const result = await this.execute(`find "${path}" -name "${pattern}" -type f`);
      if (result.exitCode !== 0) {
        return [];
      }

      const files: FileInfo[] = [];
      for (const line of result.output.split("\n")) {
        if (!line.trim()) continue;
        files.push({ path: line.trim(), is_dir: false });
      }

      return files;
    } catch (err) {
      logger.error({ error: err, pattern, path }, "[sandbox] globInfo failed");
      return [];
    }
  }
}
