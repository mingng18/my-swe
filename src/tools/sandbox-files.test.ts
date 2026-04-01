import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  sandboxDeleteTool,
  sandboxMkdirTool,
  sandboxMoveTool,
  sandboxCopyTool,
  sandboxStatTool,
  sandboxChecksumTool,
  sandboxFindTool
} from "./sandbox-files";
import { setSandboxBackend, clearSandboxBackend } from "../utils/sandboxState";

class FakeSandbox {
  commands: string[] = [];
  responses: any[] = [];

  constructor(responses: any[] = []) {
    this.responses = responses;
  }

  async execute(command: string) {
    this.commands.push(command);
    return this.responses.shift() || { exitCode: 0, output: "" };
  }
}

describe("sandboxDeleteTool", () => {
  const THREAD_ID = "test-thread-id";
  let backend: FakeSandbox;

  beforeEach(() => {
    backend = new FakeSandbox();
    setSandboxBackend(THREAD_ID, backend as any);
  });

  afterEach(() => {
    clearSandboxBackend(THREAD_ID);
  });

  test("fails when sandbox backend not initialized", async () => {
    clearSandboxBackend(THREAD_ID);
    await expect(
      sandboxDeleteTool.invoke(
        { path: "/tmp/test" },
        { configurable: { thread_id: THREAD_ID } }
      )
    ).rejects.toThrow("Sandbox backend not initialized");
  });

  test("successfully deletes a file (non-recursive)", async () => {
    const result = await sandboxDeleteTool.invoke(
      { path: "/tmp/file.txt" },
      { configurable: { thread_id: THREAD_ID } }
    );
    expect(backend.commands).toEqual(['rm -f "/tmp/file.txt"']);
    expect(result).toEqual({ path: "/tmp/file.txt", success: true, output: "" });
  });

  test("successfully deletes a directory (recursive)", async () => {
    const result = await sandboxDeleteTool.invoke(
      { path: "/tmp/dir", recursive: true },
      { configurable: { thread_id: THREAD_ID } }
    );
    expect(backend.commands).toEqual(['rm -rf "/tmp/dir"']);
    expect(result).toEqual({ path: "/tmp/dir", success: true, output: "" });
  });

  test("returns success: false when command fails", async () => {
    backend.responses.push({ exitCode: 1, output: "rm: cannot remove '/tmp/test': No such file or directory" });
    const result = await sandboxDeleteTool.invoke(
      { path: "/tmp/test" },
      { configurable: { thread_id: THREAD_ID } }
    );
    expect(result).toEqual({
      path: "/tmp/test",
      success: false,
      output: "rm: cannot remove '/tmp/test': No such file or directory"
    });
  });

  test("throws if backend.execute throws", async () => {
    backend.execute = async () => {
      throw new Error("Connection failed");
    };
    await expect(
      sandboxDeleteTool.invoke(
        { path: "/tmp/test" },
        { configurable: { thread_id: THREAD_ID } }
      )
    ).rejects.toThrow("Connection failed");
  });
});

describe("sandboxMkdirTool", () => {
  const THREAD_ID = "test-thread-id";
  let backend: FakeSandbox;

  beforeEach(() => {
    backend = new FakeSandbox();
    setSandboxBackend(THREAD_ID, backend as any);
  });

  afterEach(() => {
    clearSandboxBackend(THREAD_ID);
  });

  test("fails when sandbox backend not initialized", async () => {
    clearSandboxBackend(THREAD_ID);
    await expect(
      sandboxMkdirTool.invoke(
        { path: "/tmp/dir" },
        { configurable: { thread_id: THREAD_ID } }
      )
    ).rejects.toThrow("Sandbox backend not initialized");
  });

  test("successfully creates a directory with default args", async () => {
    const result = await sandboxMkdirTool.invoke(
      { path: "/tmp/dir" },
      { configurable: { thread_id: THREAD_ID } }
    );
    expect(backend.commands).toEqual(['mkdir -p  "/tmp/dir"']);
    expect(result).toEqual({ path: "/tmp/dir", success: true, output: "" });
  });

  test("successfully creates a directory without parents flag", async () => {
    const result = await sandboxMkdirTool.invoke(
      { path: "/tmp/dir", parents: false },
      { configurable: { thread_id: THREAD_ID } }
    );
    expect(backend.commands).toEqual(['mkdir   "/tmp/dir"']);
    expect(result).toEqual({ path: "/tmp/dir", success: true, output: "" });
  });

  test("successfully creates a directory with mode", async () => {
    const result = await sandboxMkdirTool.invoke(
      { path: "/tmp/dir", mode: 755 },
      { configurable: { thread_id: THREAD_ID } }
    );
    expect(backend.commands).toEqual(['mkdir -p -m 755 "/tmp/dir"']);
    expect(result).toEqual({ path: "/tmp/dir", success: true, output: "" });
  });

  test("returns success: false when command fails", async () => {
    backend.responses.push({ exitCode: 1, output: "mkdir: cannot create directory '/tmp/dir': File exists" });
    const result = await sandboxMkdirTool.invoke(
      { path: "/tmp/dir" },
      { configurable: { thread_id: THREAD_ID } }
    );
    expect(result).toEqual({
      path: "/tmp/dir",
      success: false,
      output: "mkdir: cannot create directory '/tmp/dir': File exists"
    });
  });
});

describe("sandboxMoveTool", () => {
  const THREAD_ID = "test-thread-id";
  let backend: FakeSandbox;

  beforeEach(() => {
    backend = new FakeSandbox();
    setSandboxBackend(THREAD_ID, backend as any);
  });

  afterEach(() => {
    clearSandboxBackend(THREAD_ID);
  });

  test("fails when sandbox backend not initialized", async () => {
    clearSandboxBackend(THREAD_ID);
    await expect(
      sandboxMoveTool.invoke(
        { source: "/tmp/src", destination: "/tmp/dest" },
        { configurable: { thread_id: THREAD_ID } }
      )
    ).rejects.toThrow("Sandbox backend not initialized");
  });

  test("successfully moves a path", async () => {
    const result = await sandboxMoveTool.invoke(
      { source: "/tmp/src", destination: "/tmp/dest" },
      { configurable: { thread_id: THREAD_ID } }
    );
    expect(backend.commands).toEqual(['mv "/tmp/src" "/tmp/dest"']);
    expect(result).toEqual({ source: "/tmp/src", destination: "/tmp/dest", success: true, output: "" });
  });

  test("returns success: false when command fails", async () => {
    backend.responses.push({ exitCode: 1, output: "mv: cannot stat '/tmp/src': No such file or directory" });
    const result = await sandboxMoveTool.invoke(
      { source: "/tmp/src", destination: "/tmp/dest" },
      { configurable: { thread_id: THREAD_ID } }
    );
    expect(result).toEqual({
      source: "/tmp/src",
      destination: "/tmp/dest",
      success: false,
      output: "mv: cannot stat '/tmp/src': No such file or directory"
    });
  });
});

describe("sandboxCopyTool", () => {
  const THREAD_ID = "test-thread-id";
  let backend: FakeSandbox;

  beforeEach(() => {
    backend = new FakeSandbox();
    setSandboxBackend(THREAD_ID, backend as any);
  });

  afterEach(() => {
    clearSandboxBackend(THREAD_ID);
  });

  test("fails when sandbox backend not initialized", async () => {
    clearSandboxBackend(THREAD_ID);
    await expect(
      sandboxCopyTool.invoke(
        { source: "/tmp/src", destination: "/tmp/dest" },
        { configurable: { thread_id: THREAD_ID } }
      )
    ).rejects.toThrow("Sandbox backend not initialized");
  });

  test("successfully copies a path", async () => {
    const result = await sandboxCopyTool.invoke(
      { source: "/tmp/src", destination: "/tmp/dest" },
      { configurable: { thread_id: THREAD_ID } }
    );
    expect(backend.commands).toEqual(['cp  "/tmp/src" "/tmp/dest"']);
    expect(result).toEqual({ source: "/tmp/src", destination: "/tmp/dest", success: true, output: "" });
  });

  test("successfully copies a path recursively", async () => {
    const result = await sandboxCopyTool.invoke(
      { source: "/tmp/src", destination: "/tmp/dest", recursive: true },
      { configurable: { thread_id: THREAD_ID } }
    );
    expect(backend.commands).toEqual(['cp -r "/tmp/src" "/tmp/dest"']);
    expect(result).toEqual({ source: "/tmp/src", destination: "/tmp/dest", success: true, output: "" });
  });

  test("returns success: false when command fails", async () => {
    backend.responses.push({ exitCode: 1, output: "cp: cannot stat '/tmp/src': No such file or directory" });
    const result = await sandboxCopyTool.invoke(
      { source: "/tmp/src", destination: "/tmp/dest" },
      { configurable: { thread_id: THREAD_ID } }
    );
    expect(result).toEqual({
      source: "/tmp/src",
      destination: "/tmp/dest",
      success: false,
      output: "cp: cannot stat '/tmp/src': No such file or directory"
    });
  });
});

describe("sandboxStatTool", () => {
  const THREAD_ID = "test-thread-id";
  let backend: FakeSandbox;

  beforeEach(() => {
    backend = new FakeSandbox();
    setSandboxBackend(THREAD_ID, backend as any);
  });

  afterEach(() => {
    clearSandboxBackend(THREAD_ID);
  });

  test("fails when sandbox backend not initialized", async () => {
    clearSandboxBackend(THREAD_ID);
    await expect(
      sandboxStatTool.invoke(
        { path: "/tmp/file.txt" },
        { configurable: { thread_id: THREAD_ID } }
      )
    ).rejects.toThrow("Sandbox backend not initialized");
  });

  test("successfully gets file stats", async () => {
    backend.responses.push({ exitCode: 0, output: "-rw-r--r-- root root 1024 2023-01-01 12:00:00.000000000 +0000" });
    const result = await sandboxStatTool.invoke(
      { path: "/tmp/file.txt" },
      { configurable: { thread_id: THREAD_ID } }
    );
    expect(backend.commands).toEqual(['stat -c "%A %U %G %s %y" "/tmp/file.txt"']);
    expect(result).toEqual({
      path: "/tmp/file.txt",
      exists: true,
      mode: "-rw-r--r--",
      owner: "root",
      group: "root",
      size: 1024,
      modified: "2023-01-01 12:00:00.000000000 +0000"
    });
  });

  test("returns exists: false when command fails", async () => {
    backend.responses.push({ exitCode: 1, output: "stat: cannot stat '/tmp/file.txt': No such file or directory" });
    const result = await sandboxStatTool.invoke(
      { path: "/tmp/file.txt" },
      { configurable: { thread_id: THREAD_ID } }
    );
    expect(result).toEqual({
      path: "/tmp/file.txt",
      exists: false,
      error: "stat: cannot stat '/tmp/file.txt': No such file or directory"
    });
  });
});

describe("sandboxChecksumTool", () => {
  const THREAD_ID = "test-thread-id";
  let backend: FakeSandbox;

  beforeEach(() => {
    backend = new FakeSandbox();
    setSandboxBackend(THREAD_ID, backend as any);
  });

  afterEach(() => {
    clearSandboxBackend(THREAD_ID);
  });

  test("fails when sandbox backend not initialized", async () => {
    clearSandboxBackend(THREAD_ID);
    await expect(
      sandboxChecksumTool.invoke(
        { path: "/tmp/file.txt" },
        { configurable: { thread_id: THREAD_ID } }
      )
    ).rejects.toThrow("Sandbox backend not initialized");
  });

  test("successfully calculates sha256 checksum (default)", async () => {
    backend.responses.push({ exitCode: 0, output: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  /tmp/file.txt\n" });
    const result = await sandboxChecksumTool.invoke(
      { path: "/tmp/file.txt" },
      { configurable: { thread_id: THREAD_ID } }
    );
    expect(backend.commands).toEqual(['sha256sum "/tmp/file.txt"']);
    expect(result).toEqual({
      path: "/tmp/file.txt",
      success: true,
      algorithm: "sha256",
      checksum: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    });
  });

  test("successfully calculates md5 checksum", async () => {
    backend.responses.push({ exitCode: 0, output: "d41d8cd98f00b204e9800998ecf8427e  /tmp/file.txt\n" });
    const result = await sandboxChecksumTool.invoke(
      { path: "/tmp/file.txt", algorithm: "md5" },
      { configurable: { thread_id: THREAD_ID } }
    );
    expect(backend.commands).toEqual(['md5sum "/tmp/file.txt"']);
    expect(result).toEqual({
      path: "/tmp/file.txt",
      success: true,
      algorithm: "md5",
      checksum: "d41d8cd98f00b204e9800998ecf8427e"
    });
  });

  test("returns success: false when command fails", async () => {
    backend.responses.push({ exitCode: 1, output: "sha256sum: /tmp/file.txt: No such file or directory" });
    const result = await sandboxChecksumTool.invoke(
      { path: "/tmp/file.txt" },
      { configurable: { thread_id: THREAD_ID } }
    );
    expect(result).toEqual({
      path: "/tmp/file.txt",
      success: false,
      error: "sha256sum: /tmp/file.txt: No such file or directory"
    });
  });
});

describe("sandboxFindTool", () => {
  const THREAD_ID = "test-thread-id";
  let backend: FakeSandbox;

  beforeEach(() => {
    backend = new FakeSandbox();
    setSandboxBackend(THREAD_ID, backend as any);
  });

  afterEach(() => {
    clearSandboxBackend(THREAD_ID);
  });

  test("fails when sandbox backend not initialized", async () => {
    clearSandboxBackend(THREAD_ID);
    await expect(
      sandboxFindTool.invoke(
        { pattern: "*.txt" },
        { configurable: { thread_id: THREAD_ID } }
      )
    ).rejects.toThrow("Sandbox backend not initialized");
  });

  test("successfully finds files with default path and any type", async () => {
    backend.responses.push({ exitCode: 0, output: "/workspace/file1.txt\n/workspace/file2.txt\n" });
    const result = await sandboxFindTool.invoke(
      { pattern: "*.txt" },
      { configurable: { thread_id: THREAD_ID } }
    );
    expect(backend.commands).toEqual(['find "/workspace" -name "*.txt" ']);
    expect(result).toEqual({
      path: "/workspace",
      pattern: "*.txt",
      type: "any",
      files: ["/workspace/file1.txt", "/workspace/file2.txt"],
      count: 2
    });
  });

  test("successfully finds files with specific path and type", async () => {
    backend.responses.push({ exitCode: 0, output: "/tmp/dir/sub/file1.txt\n" });
    const result = await sandboxFindTool.invoke(
      { path: "/tmp/dir", pattern: "*.txt", type: "f" },
      { configurable: { thread_id: THREAD_ID } }
    );
    expect(backend.commands).toEqual(['find "/tmp/dir" -name "*.txt" -type f']);
    expect(result).toEqual({
      path: "/tmp/dir",
      pattern: "*.txt",
      type: "f",
      files: ["/tmp/dir/sub/file1.txt"],
      count: 1
    });
  });

  test("handles empty results", async () => {
    backend.responses.push({ exitCode: 0, output: "" });
    const result = await sandboxFindTool.invoke(
      { pattern: "*.txt" },
      { configurable: { thread_id: THREAD_ID } }
    );
    expect(result).toEqual({
      path: "/workspace",
      pattern: "*.txt",
      type: "any",
      files: [],
      count: 0
    });
  });
});
