import { describe, expect, test, afterEach, beforeEach, mock, spyOn } from "bun:test";

mock.module("@langchain/langgraph-sdk", () => {
  return {
    Client: class Client {
      threads = {
        get: mock(),
        update: mock(),
      }
    }
  };
});

const originalEnv = { ...process.env };

describe("storeGithubTokenInThread", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("returns false and logs error when GITHUB_TOKEN_ENCRYPTION_KEY is missing", async () => {
    delete process.env.GITHUB_TOKEN_ENCRYPTION_KEY;

    const { storeGithubTokenInThread } = await import("./github-token");

    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    const result = await storeGithubTokenInThread("test-thread", "test-token");

    expect(result).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      "[github_token] GITHUB_TOKEN_ENCRYPTION_KEY is required to store GitHub token in thread metadata"
    );

    errorSpy.mockRestore();
  });
});
