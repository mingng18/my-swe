import { describe, expect, test, mock } from "bun:test";

const mockExecute = mock(() =>
  Promise.resolve({ exitCode: 0, output: "mocked" }),
);
mock.module("../utils/sandboxState", () => ({
  getSandboxBackendSync: () => ({
    execute: mockExecute,
  }),
}));

// Mock external dependencies before importing the actual module
mock.module("langchain", () => ({
  tool: (fn: any) => ({
    invoke: (args: any, runConfig: any) => fn(args, runConfig),
  }),
}));

mock.module("zod", () => {
  const chainable = () => {
    const obj = {
      optional: chainable,
      default: chainable,
      describe: chainable,
    };
    return obj;
  };
  return {
    z: {
      object: chainable,
      string: chainable,
      boolean: chainable,
      number: chainable,
      enum: chainable,
    },
  };
});

mock.module("../utils/logger", () => ({
  createLogger: () => ({
    debug: () => {},
    info: () => {},
    error: () => {},
  }),
}));

describe("sandbox-files tools command injection prevention", () => {
  test("sandboxChecksumTool escapes paths properly", async () => {
    // Dynamic import to ensure mocks are applied first
    const { sandboxChecksumTool } = await import("./sandbox-files");

    mockExecute.mockClear();
    const maliciousPath = '"; echo hacked; echo "';
    await sandboxChecksumTool.invoke(
      {
        path: maliciousPath,
        algorithm: "sha256",
      },
      { configurable: { thread_id: "test-thread" } },
    );

    expect(mockExecute.mock.calls[0][0]).toBe(
      "sha256sum '\"; echo hacked; echo \"'",
    );
  });

  test("sandboxDeleteTool escapes paths properly", async () => {
    const { sandboxDeleteTool } = await import("./sandbox-files");

    mockExecute.mockClear();
    const maliciousPathWithQuotes = "my'file.txt";
    await sandboxDeleteTool.invoke(
      {
        path: maliciousPathWithQuotes,
        recursive: true,
      },
      { configurable: { thread_id: "test-thread" } },
    );

    expect(mockExecute.mock.calls[0][0]).toBe("rm -rf 'my'\"'\"'file.txt'");
  });
});
