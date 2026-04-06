import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { codeSearchTool } from "./code-search";
import * as sandboxState from "../utils/sandboxState";

describe("codeSearchTool", () => {
  let executeMock: ReturnType<typeof mock>;

  beforeEach(() => {
    executeMock = mock();
    mock.module("../utils/sandboxState", () => {
      return {
        getSandboxBackendSync: () => ({
          execute: executeMock,
        }),
      };
    });
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
    mock.module("../utils/sandboxState", () => ({
      getSandboxBackendSync: () => null,
    }));

    const result = await codeSearchTool.invoke({ pattern: "foo" }, baseConfig);
    expect(JSON.parse(result)).toEqual({ error: "Sandbox backend not initialized. Is USE_SANDBOX=true set?" });
  });

  describe("slice mode", () => {
    test("successfully reads file slice", async () => {
      executeMock.mockResolvedValue({
        exitCode: 0,
        output: "line1\nline2\n",
      });

      const result = await codeSearchTool.invoke(
        { file_path: "test.ts", start_line: 1, end_line: 2 },
        baseConfig
      );

      expect(executeMock).toHaveBeenCalledWith("sed -n '1,2p' '/workspace/test.ts'");
      expect(JSON.parse(result)).toEqual([
        { line_number: 1, content: "line1" },
        { line_number: 2, content: "line2" },
      ]);
    });

    test("clamps end_line to MAX_SLICE_LINES (200)", async () => {
      executeMock.mockResolvedValue({ exitCode: 0, output: "line1\n" });

      await codeSearchTool.invoke(
        { file_path: "test.ts", start_line: 1, end_line: 500 },
        baseConfig
      );

      expect(executeMock).toHaveBeenCalledWith("sed -n '1,201p' '/workspace/test.ts'");
    });

    test("returns error on non-zero exit code", async () => {
      executeMock.mockResolvedValue({
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
  });

  describe("search mode", () => {
    test("returns error if missing required arguments", async () => {
      const result = await codeSearchTool.invoke({}, baseConfig);
      expect(JSON.parse(result)).toEqual({
        error: "Must provide either `pattern` (search mode) or `file_path` + `start_line` + `end_line` (slice mode).",
      });
    });

    test("successfully parses ripgrep NDJSON matches", async () => {
      executeMock.mockResolvedValue({
        exitCode: 0,
        output: `{"type":"match","data":{"path":{"text":"test.ts"},"lines":{"text":"function foo() {\\n"},"line_number":10,"absolute_offset":123}}`,
      });

      const result = await codeSearchTool.invoke(
        { pattern: "foo" },
        baseConfig
      );

      // the path resolves to /workspace/. or /workspace depending on OS/Node behavior. Let's just expect what we get
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
      executeMock.mockResolvedValue({
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

    test("handles ripgrep missing", async () => {
      executeMock.mockResolvedValue({
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
  });
});
