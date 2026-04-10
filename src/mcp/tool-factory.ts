/**
 * MCP Tool Factory for Bullhorse.
 *
 * Creates LangChain tools from MCP server tools dynamically.
 * This allows agents to use tools exposed by MCP servers.
 *
 * Based on the MCPTool pattern from Claude Code, adapted for LangChain/Bullhorse.
 */

import { tool, StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { createLogger } from "../utils/logger.js";
import { getMcpManager } from "./client.js";
import { storeArtifactAsPointer } from "../utils/memory-pointer.js";

const logger = createLogger("mcp-tool-factory");

/**
 * Maximum size for tool result before storing as memory pointer.
 */
const MAX_DIRECT_RESULT_SIZE = 5000;

/**
 * Create a LangChain tool from an MCP tool definition.
 *
 * This factory function creates a LangChain StructuredTool that wraps
 * an MCP server tool, making it available to the agent.
 */
export function createMcpTool(mcpTool: {
  serverName: string;
  name: string;
  description?: string;
  inputSchema?: any;
}): StructuredTool {
  const { serverName, name, description, inputSchema } = mcpTool;

  // Build a Zod schema from the MCP tool's input schema
  const zodSchema = buildZodSchemaFromJsonSchema(inputSchema);

  // Create the tool
  return tool(
    async (arguments_, config) => {
      const threadId = config?.configurable?.thread_id;
      const workspaceDir: string =
        config?.configurable?.repo?.workspaceDir ?? "";

      if (!workspaceDir) {
        return JSON.stringify({
          error:
            "No workspace directory available. MCP requires a repo context.",
        });
      }

      logger.debug(
        {
          thread: threadId,
          workspace: workspaceDir,
          server: serverName,
          tool: name,
        },
        "[mcp-tool] Executing tool",
      );

      try {
        const mcpManager = getMcpManager(workspaceDir);

        // Ensure connections are established
        await mcpManager.loadConfig();

        const result = await mcpManager.executeTool(serverName, {
          name,
          arguments: arguments_,
        });

        if (!result.success) {
          logger.warn(
            {
              thread: threadId,
              server: serverName,
              tool: name,
              error: result.error,
            },
            "[mcp-tool] Tool execution failed",
          );

          return JSON.stringify({
            error: result.error,
            server: serverName,
            tool: name,
          });
        }

        // Process the result content
        const content = result.content;
        const contentStr = JSON.stringify(content);

        // Check if result is large enough to store as memory pointer
        if (contentStr.length > MAX_DIRECT_RESULT_SIZE && threadId) {
          const pointer = await storeArtifactAsPointer(
            threadId,
            `mcp-tool-${serverName}-${name}`,
            contentStr,
            {
              server: serverName,
              tool: name,
              arguments: arguments_,
              resultSize: contentStr.length,
            },
          );

          logger.info(
            {
              thread: threadId,
              server: serverName,
              tool: name,
              resultSize: contentStr.length,
              pointer,
            },
            "[mcp-tool] Tool result stored as pointer",
          );

          return pointer
            ? `[Large result stored as memory pointer: ${pointer}]`
            : contentStr;
        }

        logger.info(
          {
            thread: threadId,
            server: serverName,
            tool: name,
            resultSize: contentStr.length,
          },
          "[mcp-tool] Tool executed successfully",
        );

        // Return the content directly
        return typeof content === "string" ? content : contentStr;
      } catch (err) {
        logger.error(
          {
            thread: threadId,
            server: serverName,
            tool: name,
            err,
          },
          "[mcp-tool] Tool execution error",
        );

        return JSON.stringify({
          error: `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`,
          server: serverName,
          tool: name,
        });
      }
    },
    {
      name: `mcp_${serverName}_${name}`,
      description:
        description || `MCP tool '${name}' from server '${serverName}'`,
      schema: zodSchema,
    },
  );
}

/**
 * Build a Zod schema from a JSON Schema definition.
 *
 * This is a simplified implementation that handles common JSON Schema types.
 * For production, you'd want a more robust JSON Schema to Zod converter.
 */
function buildZodSchemaFromJsonSchema(jsonSchema: any): z.ZodTypeAny {
  if (!jsonSchema || typeof jsonSchema !== "object") {
    return z.object({});
  }

  // If it's already a Zod schema, return it
  if (jsonSchema instanceof z.ZodType) {
    return jsonSchema;
  }

  const schemaType = jsonSchema.type;
  const properties = jsonSchema.properties;
  const required = jsonSchema.required || [];

  // Handle object types
  if (schemaType === "object" && properties) {
    const shape: Record<string, z.ZodTypeAny> = {};

    for (const [propName, propSchema] of Object.entries(properties as any)) {
      let fieldSchema = convertJsonSchemaToZod(propSchema);

      // Make optional if not in required array
      if (!required.includes(propName)) {
        fieldSchema = fieldSchema.optional();
      }

      shape[propName] = fieldSchema;
    }

    return z.object(shape);
  }

  // Default to empty object
  return z.object({});
}

/**
 * Convert a JSON Schema type to Zod.
 */
function convertJsonSchemaToZod(schema: any): z.ZodTypeAny {
  if (!schema || typeof schema !== "object") {
    return z.any();
  }

  const type = schema.type;

  switch (type) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "integer":
      return z.number().int();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(
        schema.items ? convertJsonSchemaToZod(schema.items) : z.any(),
      );
    case "object":
      if (schema.properties) {
        return buildZodSchemaFromJsonSchema(schema);
      }
      return z.record(z.string(), z.any());
    case "null":
      return z.null();
    default:
      // Handle union types (anyOf)
      if (schema.anyOf && Array.isArray(schema.anyOf)) {
        return z.union(
          schema.anyOf.map((s: any) => convertJsonSchemaToZod(s)) as [
            z.ZodTypeAny,
            z.ZodTypeAny,
          ],
        );
      }
      return z.any();
  }
}

/**
 * Load MCP tools and create LangChain tools for them.
 *
 * This function connects to all configured MCP servers and creates
 * LangChain tools for all exposed tools.
 */
export async function loadMcpTools(
  workspaceDir: string,
): Promise<StructuredTool[]> {
  logger.debug(
    { workspace: workspaceDir },
    "[mcp-tool-factory] Loading MCP tools",
  );

  try {
    const mcpManager = getMcpManager(workspaceDir);

    // Ensure connections are established
    await mcpManager.loadConfig();
    await mcpManager.connectAll();

    // Get all tools from all servers
    const mcpTools = await mcpManager.getAllTools();

    logger.info(
      {
        workspace: workspaceDir,
        toolCount: mcpTools.length,
      },
      "[mcp-tool-factory] MCP tools loaded",
    );

    // Create LangChain tools for each MCP tool
    const langchainTools = mcpTools.map((mcpTool) => createMcpTool(mcpTool));

    return langchainTools;
  } catch (err) {
    logger.error(
      { workspace: workspaceDir, err },
      "[mcp-tool-factory] Failed to load MCP tools",
    );

    return [];
  }
}
