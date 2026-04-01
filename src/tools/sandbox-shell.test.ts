import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { sandboxShellTool } from "./sandbox-shell";

// Mock sandboxState so we can inject a fake backend
const mockGetSandboxBackendSync = mock(() => null);

mock.module("../utils/sandboxState", () => ({
  getSandboxBackendSync: mockGetSandboxBackendSync,
}));

interface FakeExecuteResponse {
  exitCode?: number;
  output: string;
  truncated?: boolean;
}

class FakeSandbox {
  constructor(private readonly responses: FakeExecuteResponse[]) {}

  async execute(command: string): Promise<FakeExecuteResponse> {
    const next = this.responses.shift();
    return next ?? { exitCode: 0, output: "" };
  }
}

describe("sandboxShellTool", () => {
  afterEach(() => {
    mockGetSandboxBackendSync.mockClear();
    mockGetSandboxBackendSync.mockImplementation(() => null);
  });

  test("throws error when thread_id is missing from config", async () => {
    const args = { command: "echo 'hello'" };
    const config = { configurable: {} };

    // In actual implementation, it throws: "Sandbox backend not initialized. Make sure USE_SANDBOX=true is set."
    await expect(sandboxShellTool.invoke(args, config)).rejects.toThrow(
      "Sandbox backend not initialized. Make sure USE_SANDBOX=true is set."
    );
    expect(mockGetSandboxBackendSync).not.toHaveBeenCalled();
  });

  test("throws error when backend is not found for thread_id", async () => {
    const args = { command: "echo 'hello'" };
    const config = { configurable: { thread_id: "test-thread" } };

    mockGetSandboxBackendSync.mockImplementationOnce(() => null);

    // In actual implementation, it throws: "Sandbox backend not initialized. Make sure USE_SANDBOX=true is set."
    await expect(sandboxShellTool.invoke(args, config)).rejects.toThrow(
      "Sandbox backend not initialized. Make sure USE_SANDBOX=true is set."
    );
    expect(mockGetSandboxBackendSync).toHaveBeenCalledWith("test-thread");
  });

  test("executes command successfully", async () => {
    const backend = new FakeSandbox([{ exitCode: 0, output: "hello", truncated: false }]);
    mockGetSandboxBackendSync.mockImplementationOnce(() => backend);

    const args = { command: "echo 'hello'" };
    const config = { configurable: { thread_id: "test-thread" } };

    const result = await sandboxShellTool.invoke(args, config);

    expect(result).toEqual({
      stdout: "hello",
      exitCode: 0,
      truncated: false,
      command: "echo 'hello'",
    });
    expect(mockGetSandboxBackendSync).toHaveBeenCalledWith("test-thread");
  });

  test("prefixes command with shell if provided", async () => {
    const backend = new FakeSandbox([{ exitCode: 0, output: "hello python", truncated: false }]);
    mockGetSandboxBackendSync.mockImplementationOnce(() => backend);

    const args = { command: "print('hello python')", shell: "python3" };
    const config = { configurable: { thread_id: "test-thread" } };

    const result = await sandboxShellTool.invoke(args, config);

    expect(result).toEqual({
      stdout: "hello python",
      exitCode: 0,
      truncated: false,
      command: "python3 -c \"print('hello python')\"",
    });
  });

  test("handles command failure properly", async () => {
    class FailingFakeSandbox {
      async execute(_command: string): Promise<FakeExecuteResponse> {
        throw new Error("Command execution failed");
      }
    }

    const backend = new FailingFakeSandbox();
    mockGetSandboxBackendSync.mockImplementationOnce(() => backend);

    const args = { command: "false" };
    const config = { configurable: { thread_id: "test-thread" } };

    await expect(sandboxShellTool.invoke(args, config)).rejects.toThrow(
      "Command execution failed",
    );
  });
});
