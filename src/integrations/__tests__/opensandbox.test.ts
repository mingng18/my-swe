import { describe, expect, it, mock, beforeEach } from "bun:test";

// Mock the open sandbox sdk
const mockRun = mock();
const mockReadFile = mock();
const mockWriteFiles = mock();
const mockCreateDirectories = mock();
const mockKill = mock();
const mockClose = mock();
const mockGetEndpointUrl = mock();
const mockGetInfo = mock();
const mockPatchEgressRules = mock();
const mockPause = mock();
const mockResume = mock();
const mockRenew = mock();

mock.module("@alibaba-group/opensandbox", () => {
  return {
    Sandbox: {
      create: mock().mockImplementation(async () => {
        return {
          commands: {
            run: mockRun,
          },
          files: {
            readFile: mockReadFile,
            writeFiles: mockWriteFiles,
            createDirectories: mockCreateDirectories,
          },
          kill: mockKill,
          close: mockClose,
          getEndpointUrl: mockGetEndpointUrl,
          getInfo: mockGetInfo,
          patchEgressRules: mockPatchEgressRules,
          pause: mockPause,
          resume: mockResume,
          renew: mockRenew,
        };
      }),
    },
    SandboxException: class SandboxException extends Error {
      constructor(message: string) {
        super(message);
        this.name = "SandboxException";
      }
    },
    ConnectionConfig: class ConnectionConfig {},
  };
});

mock.module("../../utils/logger", () => {
  return {
    createLogger: () => ({
      debug: mock(),
      info: mock(),
      warn: mock(),
      error: mock(),
      fatal: mock(),
    }),
  };
});

describe("OpenSandboxBackend", () => {
  let backend: any;

  beforeEach(async () => {
    mockRun.mockClear();
    mockReadFile.mockClear();
    mockWriteFiles.mockClear();
    mockCreateDirectories.mockClear();
    mockKill.mockClear();
    mockClose.mockClear();
    mockGetEndpointUrl.mockClear();
    mockGetInfo.mockClear();
    mockPatchEgressRules.mockClear();
    mockPause.mockClear();
    mockResume.mockClear();
    mockRenew.mockClear();

    const { OpenSandboxBackend } = await import("../opensandbox");

    backend = new OpenSandboxBackend({
      domain: "test.domain",
      apiKey: "test-api-key",
      image: "test-image",
    });
  });

  it("should initialize sandbox on first use", async () => {
    // Calling execute should trigger initialization
    mockRun.mockResolvedValueOnce({
      logs: {
        stdout: [],
        stderr: [],
      },
      exitCode: 0,
    }); // Mock the run call inside ensureInitialized
    mockRun.mockResolvedValueOnce({
      logs: {
        stdout: [{ text: "hello" }, { text: "\n" }],
        stderr: [],
      },
      exitCode: 0,
    });

    const result = await backend.execute("echo hello");

    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("hello\n");
    expect(mockRun).toHaveBeenCalledWith("echo hello");
    expect(mockRun).toHaveBeenCalledWith("mkdir -p /large_tool_results"); // ensureInitialized
  });

  it("should handle execute with non-zero exit code", async () => {
    mockRun.mockResolvedValueOnce({
      logs: {
        stdout: [],
        stderr: [],
      },
      exitCode: 0,
    }); // init
    mockRun.mockResolvedValueOnce({
      logs: {
        stdout: [],
        stderr: [{ text: "error message\n" }],
      },
      exitCode: 1,
    });

    const result = await backend.execute("fail_command");

    expect(result.exitCode).toBe(1);
    expect(result.output).toBe("error message\n");
  });

  it("should write a file successfully", async () => {
    mockRun.mockResolvedValueOnce({
      logs: {
        stdout: [],
        stderr: [],
      },
      exitCode: 0,
    }); // init
    mockWriteFiles.mockResolvedValueOnce(undefined);
    mockCreateDirectories.mockResolvedValueOnce(undefined);

    const result = await backend.write("/test/file.txt", "content");

    expect(result).toEqual({ path: "/test/file.txt" });
    expect(mockCreateDirectories).toHaveBeenCalledWith([
      { path: "/test", mode: 755 },
    ]);
    expect(mockWriteFiles).toHaveBeenCalledWith([
      { path: "/test/file.txt", data: "content", mode: 644 },
    ]);
  });

  it("should handle file read errors", async () => {
    mockRun.mockResolvedValueOnce({
      logs: {
        stdout: [],
        stderr: [],
      },
      exitCode: 0,
    }); // init
    mockReadFile.mockRejectedValueOnce(new Error("File not found"));

    const result = await backend.readRaw("/nonexistent.txt");
    expect(result.content).toEqual([]);
  });

  it("should read a file correctly", async () => {
    mockRun.mockResolvedValueOnce({
      logs: {
        stdout: [],
        stderr: [],
      },
      exitCode: 0,
    }); // init
    mockReadFile.mockResolvedValueOnce("line 1\nline 2\n");

    const result = await backend.readRaw("/test.txt");

    expect(result.content).toEqual(["line 1", "line 2", ""]);
    expect(mockReadFile).toHaveBeenCalledWith("/test.txt");
  });

  it("should cleanup sandbox correctly", async () => {
    mockRun.mockResolvedValueOnce({
      logs: {
        stdout: [],
        stderr: [],
      },
      exitCode: 0,
    }); // init
    mockKill.mockResolvedValueOnce(undefined);
    mockClose.mockResolvedValueOnce(undefined);

    // Initialize first
    mockRun.mockResolvedValueOnce({ logs: { stdout: [], stderr: [] }, exitCode: 0 });
    await backend.execute("true");

    await backend.cleanup();

    expect(mockKill).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
  });
});
