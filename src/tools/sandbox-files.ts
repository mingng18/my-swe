/**
 * Sandbox file operation tools.
 *
 * Note: Most file operations are handled by the OpenSandboxBackend
 * implementing the BackendProtocol interface. The DeepAgents framework
 * automatically provides tools for read, write, edit, search, etc.
 *
 * This module provides additional file utilities that may be useful.
 */

import { createLogger } from "../utils/logger";
import { tool } from "langchain";
import { z } from "zod";
import { shellEscapeSingleQuotes } from "../utils/shell.js";
import { getSandboxBackendFromConfig } from "../utils/sandboxState";

import fs from "fs/promises";
import path from "path";

/**
 * Tool to read file contents from the sandbox
 */
export const readSandboxFileTool = tool(
  async (
    { filePath, startLine, endLine }: { filePath: string; startLine?: number; endLine?: number },
    config
  ) => {
    try {
      const backend = getSandboxBackendFromConfig(config);
      if (!backend) {
        throw new Error("Sandbox backend not initialized. Make sure USE_SANDBOX=true is set.");
      }
      
      const content = await backend.read(filePath);

      if (startLine !== undefined && endLine !== undefined) {
        const lines = content.split('\n');
        // Convert 1-based lines to 0-based index
        const startIdx = Math.max(0, startLine - 1);
        const endIdx = Math.min(lines.length, endLine);
        return lines.slice(startIdx, endIdx).join('\n');
      }

      return content;
    } catch (err: any) {
      logger.error({ error: err }, "[sandbox-read] Failed to read file");
      throw new Error(`Failed to read file: ${err.message}`);
    }
  },
  {
    name: "read_sandbox_file",
    description: "Read contents of a file in the sandbox environment.",
    schema: z.object({
      filePath: z.string().describe("Absolute or relative path to the file"),
      startLine: z.number().optional().describe("Starting line number (1-indexed)"),
      endLine: z.number().optional().describe("Ending line number (inclusive)")
    }),
  }
);

/**
 * Tool to write contents to a file in the sandbox
 */
export const writeSandboxFileTool = tool(
  async ({ filePath, content }: { filePath: string; content: string }, config) => {
    try {
      const backend = getSandboxBackendFromConfig(config);
      if (!backend) {
        throw new Error("Sandbox backend not initialized. Make sure USE_SANDBOX=true is set.");
      }
      
      // Ensure directory exists
      await backend.execute(`mkdir -p $(dirname ${shellEscapeSingleQuotes(filePath)})`);
      await backend.write(filePath, content);
      
      return `Successfully wrote to ${filePath}`;
    } catch (err: any) {
      logger.error({ error: err }, "[sandbox-write] Failed to write file");
      throw new Error(`Failed to write file: ${err.message}`);
    }
  },
  {
    name: "write_sandbox_file",
    description: "Write content to a file in the sandbox environment. Will create parent directories if needed.",
    schema: z.object({
      filePath: z.string().describe("Absolute or relative path to the file"),
      content: z.string().describe("Content to write to the file")
    }),
  }
);

/**
 * Tool to list files in a directory in the sandbox
 */
export const listSandboxFilesTool = tool(
  async ({ dirPath }: { dirPath: string }, config) => {
    try {
      const backend = getSandboxBackendFromConfig(config);
      if (!backend) {
        throw new Error("Sandbox backend not initialized. Make sure USE_SANDBOX=true is set.");
      }
      
      const entries = await backend.lsInfo(dirPath);
      const result = entries.map(entry => ({
        name: entry.path,
        isDirectory: entry.is_dir
      }));
      return JSON.stringify(result, null, 2);
    } catch (err: any) {
      logger.error({ error: err }, "[sandbox-list] Failed to list directory");
      throw new Error(`Failed to list directory: ${err.message}`);
    }
  },
  {
    name: "list_sandbox_files",
    description: "List files and directories in a given path.",
    schema: z.object({
      dirPath: z.string().describe("Path to the directory to list")
    }),
  }
);


const logger = createLogger("sandbox-files-tool");

/**
 * Delete a file or directory in the sandbox.
 */
export const sandboxDeleteTool = tool(
  async (
    { path, recursive }: { path: string; recursive?: boolean },
    config,
  ) => {
    const backend = getSandboxBackendFromConfig(config);
    if (!backend) {
      throw new Error(
        "Sandbox backend not initialized. Make sure USE_SANDBOX=true is set.",
      );
    }

    logger.debug({ path, recursive }, "[sandbox-delete] Deleting path");

    try {
      const flag = recursive ? "-rf" : "-f";
      const result = await backend.execute(
        `rm ${flag} ${shellEscapeSingleQuotes(path)}`,
      );

      return {
        path,
        success: result.exitCode === 0,
        output: result.output,
      };
    } catch (err) {
      logger.error({ error: err }, "[sandbox-delete] Failed to delete");
      throw err;
    }
  },
  {
    name: "sandbox_delete",
    description:
      "Delete a file or directory in the sandbox. " +
      "Use with caution - deleted files cannot be recovered. " +
      "The recursive flag is required for directories.",
    schema: z.object({
      path: z.string().describe("Absolute path to delete"),
      recursive: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Delete directories recursively (required for non-empty directories)",
        ),
    }),
  },
);

/**
 * Create a directory in the sandbox.
 */
export const sandboxMkdirTool = tool(
  async (
    {
      path,
      parents,
      mode,
    }: {
      path: string;
      parents?: boolean;
      mode?: number;
    },
    config,
  ) => {
    const backend = getSandboxBackendFromConfig(config);
    if (!backend) {
      throw new Error(
        "Sandbox backend not initialized. Make sure USE_SANDBOX=true is set.",
      );
    }

    logger.debug({ path, parents, mode }, "[sandbox-mkdir] Creating directory");

    try {
      const parentsFlag = parents ? "-p" : "";
      const modeFlag = mode ? `-m ${mode}` : "";
      const result = await backend.execute(
        `mkdir ${parentsFlag} ${modeFlag} ${shellEscapeSingleQuotes(path)}`,
      );

      return {
        path,
        success: result.exitCode === 0,
        output: result.output,
      };
    } catch (err) {
      logger.error(
        { error: err },
        "[sandbox-mkdir] Failed to create directory",
      );
      throw err;
    }
  },
  {
    name: "sandbox_mkdir",
    description:
      "Create a directory in the sandbox. " +
      "Use the parents flag to create parent directories as needed.",
    schema: z.object({
      path: z.string().describe("Absolute path of directory to create"),
      parents: z
        .boolean()
        .optional()
        .default(true)
        .describe("Create parent directories as needed (like mkdir -p)"),
      mode: z
        .number()
        .optional()
        .describe("Permission mode (e.g., 755 for rwxr-xr-x)"),
    }),
  },
);

/**
 * Move or rename a file/directory.
 */
export const sandboxMoveTool = tool(
  async (
    { source, destination }: { source: string; destination: string },
    config,
  ) => {
    const backend = getSandboxBackendFromConfig(config);
    if (!backend) {
      throw new Error(
        "Sandbox backend not initialized. Make sure USE_SANDBOX=true is set.",
      );
    }

    logger.debug({ source, destination }, "[sandbox-move] Moving path");

    try {
      const result = await backend.execute(
        `mv ${shellEscapeSingleQuotes(source)} ${shellEscapeSingleQuotes(destination)}`,
      );

      return {
        source,
        destination,
        success: result.exitCode === 0,
        output: result.output,
      };
    } catch (err) {
      logger.error({ error: err }, "[sandbox-move] Failed to move");
      throw err;
    }
  },
  {
    name: "sandbox_move",
    description:
      "Move or rename a file or directory in the sandbox. " +
      "Can move files between directories or rename in place.",
    schema: z.object({
      source: z.string().describe("Source path to move"),
      destination: z.string().describe("Destination path"),
    }),
  },
);

/**
 * Copy a file or directory.
 */
export const sandboxCopyTool = tool(
  async (
    {
      source,
      destination,
      recursive,
    }: {
      source: string;
      destination: string;
      recursive?: boolean;
    },
    config,
  ) => {
    const backend = getSandboxBackendFromConfig(config);
    if (!backend) {
      throw new Error(
        "Sandbox backend not initialized. Make sure USE_SANDBOX=true is set.",
      );
    }

    logger.debug(
      { source, destination, recursive },
      "[sandbox-copy] Copying path",
    );

    try {
      const flag = recursive ? "-r" : "";
      const result = await backend.execute(
        `cp ${flag} ${shellEscapeSingleQuotes(source)} ${shellEscapeSingleQuotes(destination)}`,
      );

      return {
        source,
        destination,
        success: result.exitCode === 0,
        output: result.output,
      };
    } catch (err) {
      logger.error({ error: err }, "[sandbox-copy] Failed to copy");
      throw err;
    }
  },
  {
    name: "sandbox_copy",
    description:
      "Copy a file or directory in the sandbox. " +
      "Use recursive flag for directories.",
    schema: z.object({
      source: z.string().describe("Source path to copy"),
      destination: z.string().describe("Destination path"),
      recursive: z
        .boolean()
        .optional()
        .default(false)
        .describe("Copy directories recursively"),
    }),
  },
);

/**
 * Get file or directory metadata.
 */
export const sandboxStatTool = tool(
  async ({ path }: { path: string }, config) => {
    const backend = getSandboxBackendFromConfig(config);
    if (!backend) {
      throw new Error(
        "Sandbox backend not initialized. Make sure USE_SANDBOX=true is set.",
      );
    }

    logger.debug({ path }, "[sandbox-stat] Getting file info");

    try {
      const result = await backend.execute(
        `stat -c "%A %U %G %s %y" ${shellEscapeSingleQuotes(path)}`,
      );

      if (result.exitCode !== 0) {
        return {
          path,
          exists: false,
          error: result.output,
        };
      }

      const parts = result.output.trim().split(/\s+/);
      return {
        path,
        exists: true,
        mode: parts[0],
        owner: parts[1],
        group: parts[2],
        size: parseInt(parts[3], 10),
        modified: parts.slice(4).join(" "),
      };
    } catch (err) {
      logger.error({ error: err }, "[sandbox-stat] Failed to get file info");
      throw err;
    }
  },
  {
    name: "sandbox_stat",
    description:
      "Get detailed metadata for a file or directory including " +
      "permissions, owner, size, and modification time.",
    schema: z.object({
      path: z.string().describe("Absolute path to query"),
    }),
  },
);

/**
 * Calculate checksum of a file.
 */
export const sandboxChecksumTool = tool(
  async (
    {
      path,
      algorithm,
    }: {
      path: string;
      algorithm?: "md5" | "sha1" | "sha256";
    },
    config,
  ) => {
    const backend = getSandboxBackendFromConfig(config);
    if (!backend) {
      throw new Error(
        "Sandbox backend not initialized. Make sure USE_SANDBOX=true is set.",
      );
    }

    logger.debug(
      { path, algorithm },
      "[sandbox-checksum] Calculating checksum",
    );

    try {
      const algo = algorithm || "sha256";
      const result = await backend.execute(
        `${algo}sum ${shellEscapeSingleQuotes(path)}`,
      );

      if (result.exitCode !== 0) {
        return {
          path,
          success: false,
          error: result.output,
        };
      }

      const checksum = result.output.split(/\s+/)[0];
      return {
        path,
        success: true,
        algorithm: algo,
        checksum,
      };
    } catch (err) {
      logger.error(
        { error: err },
        "[sandbox-checksum] Failed to calculate checksum",
      );
      throw err;
    }
  },
  {
    name: "sandbox_checksum",
    description:
      "Calculate the checksum of a file using MD5, SHA1, or SHA256. " +
      "Useful for verifying file integrity or detecting changes.",
    schema: z.object({
      path: z.string().describe("Absolute path to file"),
      algorithm: z
        .enum(["md5", "sha1", "sha256"])
        .optional()
        .default("sha256")
        .describe("Hash algorithm to use"),
    }),
  },
);

/**
 * Search for files by name pattern.
 */
export const sandboxFindTool = tool(
  async (
    {
      path,
      pattern,
      type,
    }: {
      path?: string;
      pattern: string;
      type?: "f" | "d";
    },
    config,
  ) => {
    const backend = getSandboxBackendFromConfig(config);
    if (!backend) {
      throw new Error(
        "Sandbox backend not initialized. Make sure USE_SANDBOX=true is set.",
      );
    }

    const searchPath = path || "/workspace";
    logger.debug(
      { path: searchPath, pattern, type },
      "[sandbox-find] Finding files",
    );

    try {
      const typeFlag = type ? `-type ${type}` : "";
      const result = await backend.execute(
        `find ${shellEscapeSingleQuotes(searchPath)} -name ${shellEscapeSingleQuotes(pattern)} ${typeFlag}`,
      );

      const files = result.output
        .split("\n")
        .filter((line: string) => line.trim())
        .map((line: string) => line.trim());

      return {
        path: searchPath,
        pattern,
        type: type || "any",
        files,
        count: files.length,
      };
    } catch (err) {
      logger.error({ error: err }, "[sandbox-find] Failed to find files");
      throw err;
    }
  },
  {
    name: "sandbox_find",
    description:
      "Search for files or directories by name pattern. " +
      "Similar to the Unix 'find' command.",
    schema: z.object({
      path: z
        .string()
        .optional()
        .default("/workspace")
        .describe("Directory to search from"),
      pattern: z
        .string()
        .describe("File name pattern (supports wildcards like *.txt)"),
      type: z
        .enum(["f", "d"])
        .optional()
        .describe("Filter by type: 'f' for files, 'd' for directories"),
    }),
  },
);

// Export all file tools
export const sandboxFileTools = [
  sandboxDeleteTool,
  sandboxMkdirTool,
  sandboxMoveTool,
  sandboxCopyTool,
  sandboxStatTool,
  sandboxChecksumTool,
  sandboxFindTool,
  readSandboxFileTool,
  writeSandboxFileTool,
  listSandboxFilesTool,
];
