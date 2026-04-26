import { describe, expect, test, mock, afterEach, beforeEach } from "bun:test";
import {
  sandboxDeleteTool,
  sandboxMkdirTool,
  sandboxMoveTool,
  sandboxCopyTool,
  sandboxStatTool,
  sandboxChecksumTool,
  sandboxFindTool,
  readSandboxFileTool,
  writeSandboxFileTool,
  listSandboxFilesTool
} from "../sandbox-files";
import * as fsPromises from "fs/promises";

import { spyOn } from "bun:test";
import * as sandboxState from "../../utils/sandboxState";

const mockExecute = mock();
const mockRead = mock();
const mockWrite = mock();
const mockLsInfo = mock();

beforeEach(() => {
  sandboxState.setSandboxBackend("test-thread-valid", {
    execute: mockExecute,
    read: mockRead,
    write: mockWrite,
    lsInfo: mockLsInfo
  } as any);
});

afterEach(() => {
  sandboxState.clearSandboxBackend("test-thread-valid");
});



let mockReadFile: any;
let mockWriteFile: any;
let mockMkdir: any;
let mockReaddir: any;

const originalReadFile = fsPromises.readFile;
const originalWriteFile = fsPromises.writeFile;
const originalMkdir = fsPromises.mkdir;
const originalReaddir = fsPromises.readdir;

beforeEach(() => {
  mockReadFile = spyOn(fsPromises, "readFile");
  mockWriteFile = spyOn(fsPromises, "writeFile");
  mockMkdir = spyOn(fsPromises, "mkdir");
  mockReaddir = spyOn(fsPromises, "readdir");
});

afterEach(() => {
  if (mockReadFile) mockReadFile.mockRestore();
  if (mockWriteFile) mockWriteFile.mockRestore();
  if (mockMkdir) mockMkdir.mockRestore();
  if (mockReaddir) mockReaddir.mockRestore();
});


describe("Sandbox Files Tools", () => {
  const validConfig = { configurable: { thread_id: "test-thread-valid" } };
  const invalidConfig = { configurable: { thread_id: "test-thread-invalid" } };

  beforeEach(() => {
    mockExecute.mockClear();
    mockReadFile.mockClear();
    mockWriteFile.mockClear();
    mockMkdir.mockClear();
    mockReaddir.mockClear();
  });

  describe("Backend-based tools", () => {
    describe("sandboxDeleteTool", () => {
      test("throws if backend not initialized", async () => {
        await expect(sandboxDeleteTool.invoke({ path: "/test/file" }, invalidConfig))
          .rejects.toThrow("Sandbox backend not initialized");
      });

      test("successfully deletes a file", async () => {
        mockExecute.mockResolvedValue({ exitCode: 0, output: "" });
        const result = await sandboxDeleteTool.invoke({ path: "/test/file" }, validConfig);

        expect(result).toEqual({ path: "/test/file", success: true, output: "" });
        expect(mockExecute).toHaveBeenCalledWith("rm -f '/test/file'");
      });

      test("successfully deletes a directory recursively", async () => {
        mockExecute.mockResolvedValue({ exitCode: 0, output: "" });
        const result = await sandboxDeleteTool.invoke({ path: "/test/dir", recursive: true }, validConfig);

        expect(result).toEqual({ path: "/test/dir", success: true, output: "" });
        expect(mockExecute).toHaveBeenCalledWith("rm -rf '/test/dir'");
      });

      test("handles delete failure", async () => {
        mockExecute.mockResolvedValue({ exitCode: 1, output: "No such file or directory" });
        const result = await sandboxDeleteTool.invoke({ path: "/test/missing" }, validConfig);

        expect(result).toEqual({ path: "/test/missing", success: false, output: "No such file or directory" });
      });
    });

    describe("sandboxMkdirTool", () => {
      test("successfully creates a directory with default options", async () => {
        mockExecute.mockResolvedValue({ exitCode: 0, output: "" });
        const result = await sandboxMkdirTool.invoke({ path: "/test/dir" }, validConfig);

        expect(result).toEqual({ path: "/test/dir", success: true, output: "" });
        expect(mockExecute).toHaveBeenCalledWith("mkdir -p  '/test/dir'");
      });

      test("successfully creates a directory with specific mode", async () => {
        mockExecute.mockResolvedValue({ exitCode: 0, output: "" });
        const result = await sandboxMkdirTool.invoke({ path: "/test/dir", mode: 755 }, validConfig);

        expect(result).toEqual({ path: "/test/dir", success: true, output: "" });
        expect(mockExecute).toHaveBeenCalledWith("mkdir -p -m 755 '/test/dir'");
      });

      test("successfully creates a directory without parents", async () => {
        mockExecute.mockResolvedValue({ exitCode: 0, output: "" });
        const result = await sandboxMkdirTool.invoke({ path: "/test/dir", parents: false }, validConfig);

        expect(result).toEqual({ path: "/test/dir", success: true, output: "" });
        expect(mockExecute).toHaveBeenCalledWith("mkdir   '/test/dir'");
      });
    });

    describe("sandboxMoveTool", () => {
      test("successfully moves a file", async () => {
        mockExecute.mockResolvedValue({ exitCode: 0, output: "" });
        const result = await sandboxMoveTool.invoke({ source: "/test/src", destination: "/test/dest" }, validConfig);

        expect(result).toEqual({ source: "/test/src", destination: "/test/dest", success: true, output: "" });
        expect(mockExecute).toHaveBeenCalledWith("mv '/test/src' '/test/dest'");
      });
    });

    describe("sandboxCopyTool", () => {
      test("successfully copies a file", async () => {
        mockExecute.mockResolvedValue({ exitCode: 0, output: "" });
        const result = await sandboxCopyTool.invoke({ source: "/test/src", destination: "/test/dest" }, validConfig);

        expect(result).toEqual({ source: "/test/src", destination: "/test/dest", success: true, output: "" });
        expect(mockExecute).toHaveBeenCalledWith("cp  '/test/src' '/test/dest'");
      });

      test("successfully copies a directory recursively", async () => {
        mockExecute.mockResolvedValue({ exitCode: 0, output: "" });
        const result = await sandboxCopyTool.invoke({ source: "/test/src_dir", destination: "/test/dest_dir", recursive: true }, validConfig);

        expect(result).toEqual({ source: "/test/src_dir", destination: "/test/dest_dir", success: true, output: "" });
        expect(mockExecute).toHaveBeenCalledWith("cp -r '/test/src_dir' '/test/dest_dir'");
      });
    });

    describe("sandboxStatTool", () => {
      test("successfully stats a file", async () => {
        const mockOutput = "-rw-r--r-- root root 1234 2023-01-01 12:00:00";
        mockExecute.mockResolvedValue({ exitCode: 0, output: mockOutput });
        const result = await sandboxStatTool.invoke({ path: "/test/file" }, validConfig);

        expect(result).toEqual({
          path: "/test/file",
          exists: true,
          mode: "-rw-r--r--",
          owner: "root",
          group: "root",
          size: 1234,
          modified: "2023-01-01 12:00:00"
        });
        expect(mockExecute).toHaveBeenCalledWith('stat -c "%A %U %G %s %y" \'/test/file\'');
      });

      test("handles non-existent file", async () => {
        mockExecute.mockResolvedValue({ exitCode: 1, output: "stat: cannot stat '/test/missing': No such file or directory" });
        const result = await sandboxStatTool.invoke({ path: "/test/missing" }, validConfig);

        expect(result).toEqual({ path: "/test/missing", exists: false, error: "stat: cannot stat '/test/missing': No such file or directory" });
      });
    });

    describe("sandboxChecksumTool", () => {
      test("successfully calculates checksum", async () => {
        mockExecute.mockResolvedValue({ exitCode: 0, output: "abc123def456 /test/file\n" });
        const result = await sandboxChecksumTool.invoke({ path: "/test/file" }, validConfig);

        expect(result).toEqual({
          path: "/test/file",
          success: true,
          algorithm: "sha256",
          checksum: "abc123def456"
        });
        expect(mockExecute).toHaveBeenCalledWith("sha256sum '/test/file'");
      });

      test("handles checksum failure", async () => {
        mockExecute.mockResolvedValue({ exitCode: 1, output: "No such file or directory" });
        const result = await sandboxChecksumTool.invoke({ path: "/test/missing" }, validConfig);

        expect(result).toEqual({ path: "/test/missing", success: false, error: "No such file or directory" });
      });
    });

    describe("sandboxFindTool", () => {
      test("successfully finds files", async () => {
        mockExecute.mockResolvedValue({ exitCode: 0, output: "/workspace/file1.txt\n/workspace/dir/file2.txt\n" });
        const result = await sandboxFindTool.invoke({ path: "/workspace", pattern: "*.txt" }, validConfig);

        expect(result).toEqual({
          path: "/workspace",
          pattern: "*.txt",
          type: "any",
          files: ["/workspace/file1.txt", "/workspace/dir/file2.txt"],
          count: 2
        });
        expect(mockExecute).toHaveBeenCalledWith("find '/workspace' -name '*.txt' ");
      });

      test("successfully finds files with type filter", async () => {
        mockExecute.mockResolvedValue({ exitCode: 0, output: "/workspace/file1.txt\n" });
        const result = await sandboxFindTool.invoke({ path: "/workspace", pattern: "*.txt", type: "f" }, validConfig);

        expect(result).toEqual({
          path: "/workspace",
          pattern: "*.txt",
          type: "f",
          files: ["/workspace/file1.txt"],
          count: 1
        });
        expect(mockExecute).toHaveBeenCalledWith("find '/workspace' -name '*.txt' -type f");
      });
    });
  });

  describe("Backend-based tools (formerly fs/promises)", () => {
    describe("readSandboxFileTool", () => {
      test("reads file completely", async () => {
        mockRead.mockResolvedValue("line1\\nline2\\nline3");
        const result = await readSandboxFileTool.invoke({ filePath: "/test.txt" }, validConfig);
        expect(result).toBe("line1\\nline2\\nline3");
        expect(mockRead).toHaveBeenCalledWith("/test.txt");
      });

      test("reads specific lines", async () => {
        mockRead.mockResolvedValue("line1\nline2\nline3\nline4");
        const result = await readSandboxFileTool.invoke({ filePath: "/test.txt", startLine: 2, endLine: 3 }, validConfig);
        expect(result).toBe("line2\nline3");
      });

      test("handles read error", async () => {
        mockRead.mockRejectedValue(new Error("File not found"));
        await expect(readSandboxFileTool.invoke({ filePath: "/test.txt" }, validConfig))
          .rejects.toThrow("Failed to read file: File not found");
      });
    });

    describe("writeSandboxFileTool", () => {
      test("writes file successfully", async () => {
        mockExecute.mockResolvedValue({ exitCode: 0, output: "" });
        mockWrite.mockResolvedValue(undefined);

        const result = await writeSandboxFileTool.invoke({ filePath: "/dir/test.txt", content: "data" }, validConfig);
        expect(result).toBe("Successfully wrote to /dir/test.txt");
        expect(mockExecute).toHaveBeenCalledWith("mkdir -p $(dirname '/dir/test.txt')");
        expect(mockWrite).toHaveBeenCalledWith("/dir/test.txt", "data");
      });
    });

    describe("listSandboxFilesTool", () => {
      test("lists directory contents", async () => {
        mockLsInfo.mockResolvedValue([
          { path: "file.txt", is_dir: false },
          { path: "dir1", is_dir: true }
        ]);

        const result = await listSandboxFilesTool.invoke({ dirPath: "/dir" }, validConfig);
        expect(JSON.parse(result as string)).toEqual([
          { name: "file.txt", isDirectory: false },
          { name: "dir1", isDirectory: true }
        ]);
      });
    });
  });
});
