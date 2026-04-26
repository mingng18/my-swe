import { describe, expect, test, mock } from "bun:test";
import { callMcpToolTool } from "../call-mcp-tool";
import { getMcpManager } from "../../mcp/client";

// Mock the MCP client manager
mock.module("../../mcp/client", () => ({
  getMcpManager: mock(() => ({
    loadConfig: mock(() => Promise.resolve()),
    executeTool: mock(() =>
      Promise.resolve({
        success: true,
        content: { content: [{ type: "text", text: "Tool result" }] },
      })
    ),
  })),
}));

describe("callMcpToolTool", () => {
  test("handles missing workspace directory", async () => {
    const result = await callMcpToolTool.invoke(
      {
        server: "test-server",
        name: "test-tool",
        toolArgs: { foo: "bar" },
      },
      {
        configurable: {
          thread_id: "test-thread",
          repo: { workspaceDir: "" },
        },
      }
    );

    // Result should be a JSON string
    expect(typeof result).toBe("string");

    const parsed = JSON.parse(result);
    expect(parsed).toEqual({
      error: "No workspace directory available. MCP requires a repo context.",
    });
  });

  test("handles missing thread_id", async () => {
    const result = await callMcpToolTool.invoke(
      {
        server: "test-server",
        name: "test-tool",
        toolArgs: { foo: "bar" },
      },
      {
        configurable: {
          repo: { workspaceDir: "/test/workspace" },
        },
      }
    );

    // Result should be a JSON string
    expect(typeof result).toBe("string");

    const parsed = JSON.parse(result);
    expect(parsed).toEqual({
      error: "Missing thread_id for result storage",
    });
  });

  test("executes tool with string result", async () => {
    const mockExecuteTool = mock(() =>
      Promise.resolve({
        success: true,
        content: "Simple string result",
      })
    );

    mock.module("../../mcp/client", () => ({
      getMcpManager: mock(() => ({
        loadConfig: mock(() => Promise.resolve()),
        executeTool: mockExecuteTool,
      })),
    }));

    // Re-import to get the mocked version
    const { callMcpToolTool: CallMcpToolToolFresh } = await import(
      "../call-mcp-tool"
    );

    const result = await CallMcpToolToolFresh.invoke(
      {
        server: "test-server",
        name: "test-tool",
        arguments: { foo: "bar" },
      },
      {
        configurable: {
          thread_id: "test-thread",
          repo: { workspaceDir: "/test/workspace" },
        },
      }
    );

    // Result should be a JSON string
    expect(typeof result).toBe("string");

    const parsed = JSON.parse(result);
    expect(parsed.server).toBe("test-server");
    expect(parsed.tool).toBe("test-tool");
    expect(parsed.result).toBeDefined();
  });

  test("executes tool with structured content result", async () => {
    const mockExecuteTool = mock(() =>
      Promise.resolve({
        success: true,
        content: {
          content: [
            { type: "text", text: "Line 1" },
            { type: "text", text: "Line 2" },
          ],
        },
      })
    );

    mock.module("../../mcp/client", () => ({
      getMcpManager: mock(() => ({
        loadConfig: mock(() => Promise.resolve()),
        executeTool: mockExecuteTool,
      })),
    }));

    // Re-import to get the mocked version
    const { callMcpToolTool: CallMcpToolToolFresh } = await import(
      "../call-mcp-tool"
    );

    const result = await CallMcpToolToolFresh.invoke(
      {
        server: "test-server",
        name: "test-tool",
        arguments: { foo: "bar" },
      },
      {
        configurable: {
          thread_id: "test-thread",
          repo: { workspaceDir: "/test/workspace" },
        },
      }
    );

    // Result should be a JSON string
    expect(typeof result).toBe("string");

    const parsed = JSON.parse(result);
    expect(parsed.server).toBe("test-server");
    expect(parsed.tool).toBe("test-tool");
    expect(parsed.result).toBeDefined();
    expect(parsed.result.type).toBe("result");
    expect(parsed.result.content).toBeInstanceOf(Array);
  });

  test("handles tool execution failure", async () => {
    const mockExecuteTool = mock(() =>
      Promise.resolve({
        success: false,
        error: "Tool not found",
      })
    );

    mock.module("../../mcp/client", () => ({
      getMcpManager: mock(() => ({
        loadConfig: mock(() => Promise.resolve()),
        executeTool: mockExecuteTool,
      })),
    }));

    // Re-import to get the mocked version
    const { callMcpToolTool: CallMcpToolToolFresh } = await import(
      "../call-mcp-tool"
    );

    const result = await CallMcpToolToolFresh.invoke(
      {
        server: "test-server",
        name: "nonexistent-tool",
        toolArgs: {},
      },
      {
        configurable: {
          thread_id: "test-thread",
          repo: { workspaceDir: "/test/workspace" },
        },
      }
    );

    // Result should be a JSON string
    expect(typeof result).toBe("string");

    const parsed = JSON.parse(result);
    expect(parsed.error).toBeDefined();
    expect(parsed.server).toBe("test-server");
    expect(parsed.tool).toBe("nonexistent-tool");
  });

  test("handles tool execution exception", async () => {
    const mockExecuteTool = mock(() =>
      Promise.reject(new Error("Connection lost"))
    );

    mock.module("../../mcp/client", () => ({
      getMcpManager: mock(() => ({
        loadConfig: mock(() => Promise.resolve()),
        executeTool: mockExecuteTool,
      })),
    }));

    // Re-import to get the mocked version
    const { callMcpToolTool: CallMcpToolToolFresh } = await import(
      "../call-mcp-tool"
    );

    const result = await CallMcpToolToolFresh.invoke(
      {
        server: "test-server",
        name: "test-tool",
        toolArgs: {},
      },
      {
        configurable: {
          thread_id: "test-thread",
          repo: { workspaceDir: "/test/workspace" },
        },
      }
    );

    // Result should be a JSON string
    expect(typeof result).toBe("string");

    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("Failed to execute MCP tool");
    expect(parsed.server).toBe("test-server");
    expect(parsed.tool).toBe("test-tool");
  });
});
