import { describe, expect, test, afterEach, beforeEach, mock } from "bun:test";

mock.module("@langchain/langgraph-sdk", () => {
  return {
    Client: class {
      threads = {
        update: mock(async () => {
          return true;
        }),
      };
    },
  };
});

describe("github-token utils", () => {
  const originalEnv = process.env;
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    // Make a copy of the environment before each test
    process.env = { ...originalEnv };
    originalConsoleError = console.error;
  });

  afterEach(() => {
    // Restore the original environment and console.error after each test
    process.env = originalEnv;
    console.error = originalConsoleError;
  });

  describe("storeGithubTokenInThread", () => {
    test("returns false and logs error when GITHUB_TOKEN_ENCRYPTION_KEY is not set", async () => {
      // Dynamic import to avoid top-level module resolution issues
      const { storeGithubTokenInThread } = await import("./github-token");

      const mockLoggerError = mock();
      console.error = mockLoggerError;

      // Unset the encryption key
      delete process.env.GITHUB_TOKEN_ENCRYPTION_KEY;

      const result = await storeGithubTokenInThread("test-thread-id", "test-token");

      expect(result).toBe(false);
      expect(mockLoggerError).toHaveBeenCalledTimes(1);
      expect(mockLoggerError).toHaveBeenCalledWith(
        `[github_token] GITHUB_TOKEN_ENCRYPTION_KEY is required to store GitHub token in thread metadata`
      );
    });
  });
});
