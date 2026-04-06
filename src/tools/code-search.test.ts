import { expect, test, describe, beforeEach, afterEach, mock } from "bun:test";

describe("codeSearchTool", () => {
  let mockExecute: ReturnType<typeof mock>;
  let codeSearchTool: any;
  let sandboxState: any;

  beforeEach(async () => {
    // Reset modules to ensure fresh state
    mock.module("../utils/sandboxState", () => {
      return {
        getSandboxBackendSync: () => ({
          execute: mockExecute,
        }),
      };
    });

    // Import after mocking
    const toolModule = await import("./code-search");
    codeSearchTool = toolModule.codeSearchTool;
    sandboxState = await import("../utils/sandboxState");

    mockExecute = mock(async (cmd: string) => {
      return { exitCode: 0, output: "" };
    });
  });

  afterEach(() => {
    mock.restore();
  });

  test("handles missing thread_id", async () => {
    const result = await codeSearchTool.invoke(
      { pattern: "test" },
      { configurable: {} },
    );
    expect(result).toBe(JSON.stringify({ error: "Missing thread_id" }));
  });

  test("search mode ignores invalid json output from ripgrep", async () => {
    mockExecute.mockResolvedValueOnce({
      exitCode: 0,
      output: [
        "not a valid json string",
        '{"type":"match","data":{"path":{"text":"src/file.ts"},"line_number":10,"lines":{"text":"const x = 1;\\n"}}}',
        "{ invalid json again",
        '{"type":"match","data":{"path":{"text":"src/file.ts"},"line_number":15,"lines":{"text":"const y = 2;"}}}',
      ].join("\n"),
    });

    const config = {
      configurable: {
        thread_id: "test-thread",
        repo: { workspaceDir: "/workspace" },
      },
    };

    const rawResult = await codeSearchTool.invoke({ pattern: "const" }, config);
    const result = JSON.parse(rawResult);

    expect(result.matches).toHaveLength(2);
    expect(result.matches[0].line).toBe(10);
    expect(result.matches[1].line).toBe(15);
    expect(result.total).toBe(2);
  });

  test("search mode handles context lines", async () => {
    mockExecute.mockResolvedValueOnce({
      exitCode: 0,
      output: [
        '{"type":"match","data":{"path":{"text":"src/file.ts"},"line_number":10,"lines":{"text":"const x = 1;"}}}',
        '{"type":"context","data":{"path":{"text":"src/file.ts"},"line_number":11,"lines":{"text":"// after"}}}',
      ].join("\n"),
    });

    const config = {
      configurable: {
        thread_id: "test-thread",
        repo: { workspaceDir: "/workspace" },
      },
    };

    const rawResult = await codeSearchTool.invoke(
      { pattern: "const", context_lines: 1 },
      config,
    );
    const result = JSON.parse(rawResult);

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].context_after).toEqual(["// after"]);
  });

  test("slice mode happy path", async () => {
    mockExecute.mockResolvedValueOnce({
      exitCode: 0,
      output: "line1\nline2\nline3\n",
    });

    const config = {
      configurable: {
        thread_id: "test-thread",
        repo: { workspaceDir: "/workspace" },
      },
    };

    const rawResult = await codeSearchTool.invoke(
      { file_path: "src/file.ts", start_line: 1, end_line: 3 },
      config,
    );
    const result = JSON.parse(rawResult);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ line_number: 1, content: "line1" });
    expect(result[1]).toEqual({ line_number: 2, content: "line2" });
    expect(result[2]).toEqual({ line_number: 3, content: "line3" });
  });


  test("handles sandbox execute throwing an error in search mode", async () => {
    mockExecute.mockRejectedValueOnce(new Error("Sandbox crashed"));

    const config = { configurable: { thread_id: "test-thread", repo: { workspaceDir: "/workspace" } } };

    const rawResult = await codeSearchTool.invoke({ pattern: "const" }, config);
    expect(rawResult).toBe(JSON.stringify({ error: "Error executing search: Sandbox crashed" }));
  });

  test("handles sandbox execute throwing an error in slice mode", async () => {
    mockExecute.mockRejectedValueOnce(new Error("Sandbox read failed"));

    const config = { configurable: { thread_id: "test-thread", repo: { workspaceDir: "/workspace" } } };

    const rawResult = await codeSearchTool.invoke({ file_path: "src/file.ts", start_line: 1, end_line: 3 }, config);
    expect(rawResult).toBe(JSON.stringify({ error: "Error executing search: Sandbox read failed" }));
  });
});
