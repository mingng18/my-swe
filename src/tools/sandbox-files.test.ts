import { describe, expect, test, mock } from "bun:test";
import {
  sandboxFindTool,
  sandboxDeleteTool,
  sandboxMkdirTool,
  sandboxMoveTool,
  sandboxCopyTool,
  sandboxStatTool,
  sandboxChecksumTool
} from "./sandbox-files";

const mockExecute = mock();

mock.module("../utils/sandboxState", () => ({
  getSandboxBackendSync: () => ({
    execute: mockExecute
  })
}));

describe("sandbox-files tools", () => {
  test("sandboxFindTool escapes path and pattern properly", async () => {
    mockExecute.mockResolvedValueOnce({ exitCode: 0, output: "file1\nfile2\n" });

    await sandboxFindTool.invoke({
      path: "/dir'with\"quotes$(rm -rf /)",
      pattern: "test'; ls #",
      type: "f"
    }, { configurable: { thread_id: "test-thread" } });

    expect(mockExecute).toHaveBeenCalledWith(
      `find '/dir'"'"'with"quotes$(rm -rf /)' -name 'test'"'"'; ls #' -type f`
    );
  });

  test("sandboxDeleteTool escapes path properly", async () => {
    mockExecute.mockResolvedValueOnce({ exitCode: 0, output: "" });

    await sandboxDeleteTool.invoke({
      path: "test'; ls #"
    }, { configurable: { thread_id: "test-thread" } });

    expect(mockExecute).toHaveBeenCalledWith(
      `rm -f 'test'"'"'; ls #'`
    );
  });

  test("sandboxMkdirTool escapes path properly", async () => {
    mockExecute.mockResolvedValueOnce({ exitCode: 0, output: "" });

    await sandboxMkdirTool.invoke({
      path: "test'; ls #"
    }, { configurable: { thread_id: "test-thread" } });

    expect(mockExecute).toHaveBeenCalledWith(
      `mkdir -p  'test'"'"'; ls #'`
    );
  });

  test("sandboxMoveTool escapes source and destination properly", async () => {
    mockExecute.mockResolvedValueOnce({ exitCode: 0, output: "" });

    await sandboxMoveTool.invoke({
      source: "src'; ls #",
      destination: "dest'; rm -rf / #"
    }, { configurable: { thread_id: "test-thread" } });

    expect(mockExecute).toHaveBeenCalledWith(
      `mv 'src'"'"'; ls #' 'dest'"'"'; rm -rf / #'`
    );
  });

  test("sandboxCopyTool escapes source and destination properly", async () => {
    mockExecute.mockResolvedValueOnce({ exitCode: 0, output: "" });

    await sandboxCopyTool.invoke({
      source: "src'; ls #",
      destination: "dest'; rm -rf / #"
    }, { configurable: { thread_id: "test-thread" } });

    expect(mockExecute).toHaveBeenCalledWith(
      `cp  'src'"'"'; ls #' 'dest'"'"'; rm -rf / #'`
    );
  });

  test("sandboxStatTool escapes path properly", async () => {
    mockExecute.mockResolvedValueOnce({ exitCode: 0, output: "-rw-r--r-- user group 123 2023-01-01" });

    await sandboxStatTool.invoke({
      path: "test'; ls #"
    }, { configurable: { thread_id: "test-thread" } });

    expect(mockExecute).toHaveBeenCalledWith(
      `stat -c "%A %U %G %s %y" 'test'"'"'; ls #'`
    );
  });

  test("sandboxChecksumTool escapes path properly", async () => {
    mockExecute.mockResolvedValueOnce({ exitCode: 0, output: "1234567890abcdef file.txt" });

    await sandboxChecksumTool.invoke({
      path: "test'; ls #"
    }, { configurable: { thread_id: "test-thread" } });

    expect(mockExecute).toHaveBeenCalledWith(
      `sha256sum 'test'"'"'; ls #'`
    );
  });
});
