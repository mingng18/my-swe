import { expect, test, describe, beforeEach, afterEach, mock } from "bun:test";

describe("codeSearchTool", () => {
  let mockExecute: ReturnType<typeof mock>;
  let codeSearchTool: any;

  beforeEach(async () => {
    mockExecute = mock(async (cmd: string) => {
      return { exitCode: 0, output: "" };
    });

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
  });

  afterEach(() => {
    mock.restore();
  });

  const baseConfig = {
    configurable: {
      thread_id: "test-thread",
      repo: { workspaceDir: "/workspace" },
    },
  };

  test("returns error if thread_id is missing", async () => {
    const result = await codeSearchTool.invoke({ pattern: "foo" }, { configurable: {} });
    expect(JSON.parse(result)).toEqual({ error: "Missing thread_id" });
  });

  test("returns error if sandbox is not initialized", async () => {
    // Override the mock for this specific test
    mock.module("../utils/sandboxState", () => ({
      getSandboxBackendSync: () => null,
    }));
    
    // We need to re-import because of how Bun's module mocking works
    const { codeSearchTool: tool } = await import("./code-search");

    const result = await tool.invoke({ pattern: "foo" }, baseConfig);
    expect(JSON.parse(result)).toEqual({ error: "Sandbox backend not initialized. Is USE_SANDBOX=true set?" });
  });

  describe("slice mode", () => {
    test("successfully reads file slice", async () => {
      mockExecute.mockResolvedValue({
        exitCode: 0,
        output: "line1\nline2\n",
      });

      const result = await codeSearchTool.invoke(
        { file_path: "test.ts", start_line: 1, end_line: 2 },
        baseConfig
      );

      expect(mockExecute).toHaveBeenCalledWith("sed -n '1,2p' '/workspace/test.ts'");
      expect(JSON.parse(result)).toEqual([
        { line_number: 1, content: "line1" },
        { line_number: 2, content: "line2" },
      ]);
    });

    test("clamps end_line to MAX_SLICE_LINES (200)", async () => {
      mockExecute.mockResolvedValue({ exitCode: 0, output: "line1\n" });

      await codeSearchTool.invoke(
        { file_path: "test.ts", start_line: 1, end_line: 500 },
        baseConfig
      );

      expect(mockExecute).toHaveBeenCalledWith("sed -n '1,201p' '/workspace/test.ts'");
    });

    test("returns error on non-zero exit code", async () => {
      mockExecute.mockResolvedValue({
        exitCode: 1,
        output: "sed: can't read /workspace/test.ts: No such file or directory",
      });

      const result = await codeSearchTool.invoke(
        { file_path: "test.ts", start_line: 1, end_line: 2 },
        baseConfig
      );

      expect(JSON.parse(result)).toEqual({
        error: "Failed to read file slice: sed: can't read /workspace/test.ts: No such file or directory",
      });
    });

    test("handles sandbox execute throwing an error in slice mode", async () => {
      mockExecute.mockRejectedValueOnce(new Error("Sandbox read failed"));

      const rawResult = await codeSearchTool.invoke({ file_path: "test.ts", start_line: 1, end_line: 2 }, baseConfig);
      expect(rawResult).toBe(JSON.stringify({ error: "Error executing search: Sandbox read failed" }));
    });
  });

  describe("search mode", () => {
    test("returns error if missing required arguments", async () => {
      const result = await codeSearchTool.invoke({}, baseConfig);
      expect(JSON.parse(result)).toEqual({
        error: "Must provide either `pattern` (search mode) or `file_path` + `start_line` + `end_line` (slice mode).",
      });
    });

    test("successfully parses ripgrep NDJSON matches", async () => {
      mockExecute.mockResolvedValue({
        exitCode: 0,
        output: `{"type":"match","data":{"path":{"text":"test.ts"},"lines":{"text":"function foo() {\\n"},"line_number":10,"absolute_offset":123}}`,
      });

      const result = await codeSearchTool.invoke(
        { pattern: "foo" },
        baseConfig
      );

      const parsed = JSON.parse(result);
      expect(parsed.total).toBe(1);
      expect(parsed.matches).toEqual([
        {
          file: "test.ts",
          line: 10,
          content: "function foo() {",
          context_before: [],
          context_after: [],
        },
      ]);
    });

    test("parses ripgrep context lines", async () => {
      mockExecute.mockResolvedValue({
        exitCode: 0,
        output: [
          `{"type":"context","data":{"path":{"text":"test.ts"},"lines":{"text":"// before match\\n"},"line_number":9}}`,
          `{"type":"match","data":{"path":{"text":"test.ts"},"lines":{"text":"function foo() {\\n"},"line_number":10}}`,
          `{"type":"context","data":{"path":{"text":"test.ts"},"lines":{"text":"// after match\\n"},"line_number":11}}`,
        ].join("\n"),
      });

      const result = await codeSearchTool.invoke(
        { pattern: "foo", context_lines: 1 },
        baseConfig
      );

      const parsed = JSON.parse(result);
      expect(parsed.total).toBe(1);
      expect(parsed.matches).toEqual([
        {
          file: "test.ts",
          line: 10,
          content: "function foo() {",
          context_before: ["// before match"],
          context_after: ["// after match"],
        },
      ]);
    });

    test("ignores invalid json output from ripgrep", async () => {
      mockExecute.mockResolvedValueOnce({
        exitCode: 0,
        output: [
          "not a valid json string",
          '{"type":"match","data":{"path":{"text":"src/file.ts"},"line_number":10,"lines":{"text":"const x = 1;\\n"}}}',
          "{ invalid json again",
          '{"type":"match","data":{"path":{"text":"src/file.ts"},"line_number":15,"lines":{"text":"const y = 2;"}}}',
        ].join("\n"),
      });

      const rawResult = await codeSearchTool.invoke({ pattern: "const" }, baseConfig);
      const result = JSON.parse(rawResult);

      expect(result.matches).toHaveLength(2);
      expect(result.matches[0].line).toBe(10);
      expect(result.matches[1].line).toBe(15);
      expect(result.total).toBe(2);
    });

    test("handles ripgrep missing", async () => {
      mockExecute.mockResolvedValue({
        exitCode: 0,
        output: "bash: rg: command not found",
      });

      const result = await codeSearchTool.invoke(
        { pattern: "foo" },
        baseConfig
      );

      expect(JSON.parse(result)).toEqual({
        error: "ripgrep (rg) is not installed in this sandbox. Install it with: apt-get install -y ripgrep",
      });
    });

    test("handles sandbox execute throwing an error in search mode", async () => {
      mockExecute.mockRejectedValueOnce(new Error("Sandbox crashed"));

      const rawResult = await codeSearchTool.invoke({ pattern: "const" }, baseConfig);
      expect(rawResult).toBe(JSON.stringify({ error: "Error executing search: Sandbox crashed" }));
    });
  });
});
