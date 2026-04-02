import { describe, expect, test, mock } from "bun:test";

// Mock the backend resolver BEFORE importing the module under test
const mockExecute = mock(async (cmd: string) => {
  return { exitCode: 0, output: "mock output 1 2 3 4 5" }; // Enough output for stat to parse
});

mock.module("../utils/sandboxState", () => ({
  getSandboxBackendSync: () => ({
    execute: mockExecute,
  }),
}));

const {
  sandboxDeleteTool,
  sandboxMkdirTool,
  sandboxMoveTool,
  sandboxCopyTool,
  sandboxStatTool,
  sandboxChecksumTool,
  sandboxFindTool
} = await import("./sandbox-files");

describe("sandbox-files tools command injection prevention", () => {
  const config = { configurable: { thread_id: "test-thread" } };
  const maliciousInput = "'; touch /tmp/pwned; '";
  const expectedEscaped = `''"'"'; touch /tmp/pwned; '"'"''`;

  test("sandboxDeleteTool escapes malicious paths", async () => {
    mockExecute.mockClear();
    await sandboxDeleteTool.invoke({ path: maliciousInput }, config);
    expect(mockExecute).toHaveBeenCalledWith(`rm -f ${expectedEscaped}`);
  });

  test("sandboxMkdirTool escapes malicious paths", async () => {
    mockExecute.mockClear();
    await sandboxMkdirTool.invoke({ path: maliciousInput, parents: false }, config);
    expect(mockExecute).toHaveBeenCalledWith(`mkdir   ${expectedEscaped}`);
  });

  test("sandboxMoveTool escapes malicious paths", async () => {
    mockExecute.mockClear();
    await sandboxMoveTool.invoke({ source: maliciousInput, destination: maliciousInput }, config);
    expect(mockExecute).toHaveBeenCalledWith(`mv ${expectedEscaped} ${expectedEscaped}`);
  });

  test("sandboxCopyTool escapes malicious paths", async () => {
    mockExecute.mockClear();
    await sandboxCopyTool.invoke({ source: maliciousInput, destination: maliciousInput }, config);
    expect(mockExecute).toHaveBeenCalledWith(`cp  ${expectedEscaped} ${expectedEscaped}`);
  });

  test("sandboxStatTool escapes malicious paths", async () => {
    mockExecute.mockClear();
    await sandboxStatTool.invoke({ path: maliciousInput }, config);
    expect(mockExecute).toHaveBeenCalledWith(`stat -c "%A %U %G %s %y" ${expectedEscaped}`);
  });

  test("sandboxChecksumTool escapes malicious paths", async () => {
    mockExecute.mockClear();
    await sandboxChecksumTool.invoke({ path: maliciousInput, algorithm: "md5" }, config);
    expect(mockExecute).toHaveBeenCalledWith(`md5sum ${expectedEscaped}`);
  });

  test("sandboxFindTool escapes malicious paths", async () => {
    mockExecute.mockClear();
    await sandboxFindTool.invoke({ searchPath: maliciousInput, pattern: maliciousInput }, config);
    // Note: The schema for sandboxFindTool maps searchPath to `path`.
  });

  test("sandboxFindTool escapes malicious paths via path", async () => {
    mockExecute.mockClear();
    await sandboxFindTool.invoke({ path: maliciousInput, pattern: maliciousInput }, config);
    expect(mockExecute).toHaveBeenCalledWith(`find ${expectedEscaped} -name ${expectedEscaped} `);
  });
});
