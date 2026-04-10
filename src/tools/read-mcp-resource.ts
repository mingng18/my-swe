/**
 * Read MCP Resource Tool for Bullhorse.
 *
 * Reads a specific resource from an MCP server by URI.
 * Resources are data sources that MCP servers expose.
 *
 * Based on the ReadMcpResourceTool pattern from Claude Code, adapted for LangChain/Bullhorse.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createLogger } from "../utils/logger.js";
import { getMcpManager } from "../mcp/client.js";
import { storeArtifactAsPointer } from "../utils/memory-pointer.js";

const logger = createLogger("read-mcp-resource");

/**
 * Maximum size for resource content before storing as memory pointer.
 */
const MAX_DIRECT_SIZE = 5000;

/**
 * Tool to read a specific resource from an MCP server.
 *
 * Usage:
 * - Read a resource: `readMcpResource({ server: "myserver", uri: "file:///path/to/file" })`
 */
export const readMcpResourceTool = tool(
  async ({ server, uri }, config) => {
    const threadId = config?.configurable?.thread_id;
    const workspaceDir: string = config?.configurable?.repo?.workspaceDir ?? "";

    if (!workspaceDir) {
      return JSON.stringify({
        error: "No workspace directory available. MCP requires a repo context.",
      });
    }

    if (!threadId) {
      return JSON.stringify({
        error: "Missing thread_id for resource storage",
      });
    }

    logger.debug(
      { thread: threadId, workspace: workspaceDir, server, uri },
      "[read-mcp-resource] Reading resource"
    );

    try {
      const mcpManager = getMcpManager(workspaceDir);

      // Ensure connections are established
      await mcpManager.loadConfig();

      const result = await mcpManager.readResource(server, uri);

      if (!result.success) {
        logger.warn(
          { thread: threadId, server, uri, error: result.error },
          "[read-mcp-resource] Resource read failed"
        );

        return JSON.stringify({
          error: result.error,
          server,
          uri,
        });
      }

      // Process the resource content
      const contents = result.content?.contents || [];

      const processedContents = await Promise.all(
        contents.map(async (c: any, i: number) => {
          // Handle text content
          if (c.text) {
            return {
              uri: c.uri,
              mimeType: c.mimeType,
              text: c.text,
            };
          }

          // Handle binary blob content - decode and store as file
          if (c.blob) {
            try {
              const buffer = Buffer.from(c.blob, "base64");
              const extension = getExtensionForMimeType(c.mimeType);
              const filename = `mcp-resource-${Date.now()}-${i}${extension}`;

              // Store as memory pointer to avoid context bloat
              const pointer = await storeArtifactAsPointer(
                threadId,
                `mcp-resource-${server}-${i}`,
                JSON.stringify({
                  uri: c.uri,
                  mimeType: c.mimeType,
                  size: buffer.length,
                  base64: c.blob,
                }),
                {
                  server,
                  uri: c.uri,
                  mimeType: c.mimeType,
                  size: buffer.length,
                }
              );

              return {
                uri: c.uri,
                mimeType: c.mimeType,
                blobSavedTo: filename,
                text: pointer
                  ? `[Binary content stored as memory pointer: ${pointer}]`
                  : `[Binary content: ${buffer.length} bytes, ${c.mimeType}]`,
              };
            } catch (blobErr) {
              return {
                uri: c.uri,
                mimeType: c.mimeType,
                text: `[Error processing binary content: ${blobErr instanceof Error ? blobErr.message : String(blobErr)}]`,
              };
            }
          }

          return {
            uri: c.uri,
            mimeType: c.mimeType,
          };
        })
      );

      logger.info(
        {
          thread: threadId,
          server,
          uri,
          contentCount: processedContents.length,
        },
        "[read-mcp-resource] Resource read successfully"
      );

      return JSON.stringify({
        contents: processedContents,
        server,
        uri,
      });
    } catch (err) {
      logger.error(
        { thread: threadId, server, uri, err },
        "[read-mcp-resource] Failed to read resource"
      );

      return JSON.stringify({
        error: `Failed to read MCP resource: ${err instanceof Error ? err.message : String(err)}`,
        server,
        uri,
      });
    }
  },
  {
    name: "read_mcp_resource",
    description:
      "Read a specific resource from an MCP server, identified by server name and resource URI. Resources are data sources like files, database query results, or API responses that MCP servers expose.",
    schema: z.object({
      server: z
        .string()
        .describe("The name of the MCP server to read from"),
      uri: z.string().describe("The URI of the resource to read"),
    }),
  }
);

/**
 * Get file extension for a MIME type.
 */
function getExtensionForMimeType(mimeType?: string): string {
  if (!mimeType) return ".bin";

  const extensions: Record<string, string> = {
    "application/json": ".json",
    "text/plain": ".txt",
    "text/html": ".html",
    "text/css": ".css",
    "text/javascript": ".js",
    "application/javascript": ".js",
    "text/markdown": ".md",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "application/pdf": ".pdf",
  };

  return extensions[mimeType] || ".bin";
}
