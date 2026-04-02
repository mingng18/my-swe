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
import { getSandboxBackendSync } from "../utils/sandboxState";
import { shellEscapeSingleQuotes } from "../utils/shell";

const logger = createLogger("sandbox-files-tool");

function getSandboxBackendFromConfig(config: any): any {
  const threadId = config?.configurable?.thread_id;
  const backend = threadId ? getSandboxBackendSync(threadId) : null;
  logger.debug(
    { threadId, hasBackend: Boolean(backend) },
    "[sandbox-files] Resolved sandbox backend from config",
  );
  return backend;
}

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
];
