import { describe, expect, it, spyOn, beforeEach, mock } from "bun:test";

// Mock the module before importing OpenSandboxBackend
mock.module("@alibaba-group/opensandbox", () => ({
  Sandbox: class {},
  SandboxException: class {},
  ConnectionConfig: class {}
}));

// We need to bypass logger entirely because it depends on pino which isn't available in tests.
mock.module("../utils/logger", () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {}
  })
}));

describe("OpenSandboxBackend", () => {
  describe("grepRaw", () => {
    let backend: any;

    beforeEach(async () => {
      // Must dynamically import AFTER mocking dependencies
      const { OpenSandboxBackend } = await import("../opensandbox");
      backend = new OpenSandboxBackend({
        domain: "test.domain",
        apiKey: "test-key"
      });

      // Mock ensureInitialized to do nothing so we don't connect to sandbox
      spyOn(backend as any, "ensureInitialized").mockResolvedValue(undefined);
    });

    it("should return empty array when exit code is 1 (no matches)", async () => {
      // Mock execute to simulate no matches
      spyOn(backend, "execute").mockResolvedValue({
        exitCode: 1,
        output: "",
        truncated: false
      });

      const result = await backend.grepRaw("testPattern");
      expect(result).toEqual([]);
    });

    it("should ignore empty lines and lines without colons", async () => {
      // Mock execute to return valid and invalid lines
      spyOn(backend, "execute").mockResolvedValue({
        exitCode: 0,
        output: "file1.ts:10:match 1\n\njust a line without colons\nfile2.ts:no_second_colon\nfile3.ts:20:match 2\n",
        truncated: false
      });

      const result = await backend.grepRaw("testPattern");
      expect(result).toEqual([
        {
          path: "file1.ts",
          line: 10,
          text: "match 1"
        },
        {
          path: "file3.ts",
          line: 20,
          text: "match 2"
        }
      ]);
    });

    it("should return error message when exit code is neither 0 nor 1", async () => {
      spyOn(backend, "execute").mockResolvedValue({
        exitCode: 2,
        output: "grep: invalid option",
        truncated: false
      });

      const result = await backend.grepRaw("testPattern");
      expect(result).toBe("Search error: grep: invalid option");
    });

    it("should return error message when execute throws an error", async () => {
      spyOn(backend, "execute").mockRejectedValue(new Error("Execution failed"));

      const result = await backend.grepRaw("testPattern");
      expect(result).toBe("Search failed: Execution failed");
    });
  });
});
