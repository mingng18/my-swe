/**
 * Call MCP Tool Tool for Bullhorse.
 *
 * Executes a tool from a configured MCP server.
 * Tools are operations that MCP servers expose (like running commands, querying databases, etc.).
 *
 * Based on the CallMcpToolTool pattern from Claude Code, adapted for LangChain/Bullhorse.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createLogger } from "../utils/logger.js";
import { getMcpManager } from "../mcp/client.js";
import { storeArtifactAsPointer } from "../utils/memory-pointer.js";

const logger = createLogger("call-mcp-tool");

/**
 * Maximum size for tool result content before storing as memory pointer.
 */
const MAX_DIRECT_SIZE = 5000;

/**
 * Tool to execute a tool on an MCP server.
 *
 * Usage:
 * - Execute a tool: `callMcpTool({ server: "myserver", name: "tool_name", arguments: { ... } })`
 */
export const callMcpToolTool = tool(
  async ({ server, name, toolArgs }, config) => {
    const threadId = config?.configurable?.thread_id;
    const workspaceDir: string = config?.configurable?.repo?.workspaceDir ?? "";

    if (!workspaceDir) {
      return JSON.stringify({
        error: "No workspace directory available. MCP requires a repo context.",
      });
    }

    if (!threadId) {
      return JSON.stringify({
        error: "Missing thread_id for result storage",
      });
    }

    logger.debug(
      { thread: threadId, workspace: workspaceDir, server, name },
      "[call-mcp-tool] Executing tool"
    );

    try {
      const mcpManager = getMcpManager(workspaceDir);

      // Ensure connections are established
      await mcpManager.loadConfig();

      const result = await mcpManager.executeTool(server, {
        name,
        arguments: toolArgs || {},
      });

      if (!result.success) {
        logger.warn(
          { thread: threadId, server, name, error: result.error },
          "[call-mcp-tool] Tool execution failed"
        );

        return JSON.stringify({
          error: result.error,
          server,
          tool: name,
        });
      }

      // Process the tool result content
      const content = result.content;

      // Handle text content
      let processedContent: any;
      if (content && typeof content === "object") {
        // Check if content has content items (MCP tool result format)
        if (content.content && Array.isArray(content.content)) {
          const processedItems = await Promise.all(
            content.content.map(async (item: any, i: number) => {
              // Handle text content
              if (item.text) {
                return {
                  type: "text",
                  text: item.text,
                };
              }

              // Handle image data
              if (item.data && item.mimeType?.startsWith("image/")) {
                try {
                  const buffer = Buffer.from(item.data, "base64");
                  const extension = getExtensionForMimeType(item.mimeType);
                  const filename = `mcp-tool-result-${Date.now()}-${i}${extension}`;

                  // Store as memory pointer to avoid context bloat
                  const pointer = await storeArtifactAsPointer(
                    threadId,
                    `mcp-tool-${server}-${name}`,
                    JSON.stringify({
                      tool: name,
                      server,
                      mimeType: item.mimeType,
                      size: buffer.length,
                      base64: item.data,
                    }),
                    {
                      server,
                      tool: name,
                      mimeType: item.mimeType,
                      size: buffer.length,
                    }
                  );

                  return {
                    type: "image",
                    mimeType: item.mimeType,
                    data: pointer
                      ? `[Image data stored as memory pointer: ${pointer}]`
                      : `[Image data: ${buffer.length} bytes, ${item.mimeType}]`,
                  };
                } catch (blobErr) {
                  return {
                    type: "image",
                    mimeType: item.mimeType,
                    data: `[Error processing image data: ${blobErr instanceof Error ? blobErr.message : String(blobErr)}]`,
                  };
                }
              }

              // Handle embedded resource
              if (item.type === "resource") {
                return {
                  type: "resource",
                  uri: item.uri,
                  ...item,
                };
              }

              return item;
            })
          );

          processedContent = {
            type: "result",
            content: processedItems,
          };
        } else {
          // Raw content object
          processedContent = content;
        }
      } else if (content && typeof content === "string") {
        // String content - check if it should be stored as pointer
        const pointer = await storeArtifactAsPointer(
          threadId,
          `mcp-tool-${server}-${name}`,
          content,
          {
            server,
            tool: name,
          }
        );

        processedContent = pointer
          ? { type: "text", text: pointer, isStored: true }
          : { type: "text", text: content };
      } else {
        processedContent = content;
      }

      logger.info(
        {
          thread: threadId,
          server,
          tool: name,
          hasContent: !!content,
        },
        "[call-mcp-tool] Tool executed successfully"
      );

      return JSON.stringify({
        result: processedContent,
        server,
        tool: name,
      });
    } catch (err) {
      logger.error(
        { thread: threadId, server, name, err },
        "[call-mcp-tool] Failed to execute tool"
      );

      return JSON.stringify({
        error: `Failed to execute MCP tool: ${err instanceof Error ? err.message : String(err)}`,
        server,
        tool: name,
      });
    }
  },
  {
    name: "call_mcp_tool",
    description:
      "Execute a tool from a configured MCP server, identified by server name, tool name, and tool arguments. Tools are operations that MCP servers expose, such as running commands, querying databases, making API requests, or other server-specific capabilities. Use list_mcp_resources first to discover available resources, and use this tool to interact with server capabilities.",
    schema: z.object({
      server: z
        .string()
        .describe("The name of the MCP server to execute the tool on"),
      name: z.string().describe("The name of the tool to execute"),
      toolArgs: z
        .any()
        .optional()
        .describe("The arguments to pass to the tool (object or array)"),
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
