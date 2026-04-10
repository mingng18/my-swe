import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

let mockPostGithubComment = mock().mockResolvedValue(true);
let mockGetGithubTokenFromThread = mock().mockResolvedValue(["mock_thread_token"]);

mock.module("../../utils/github/index", () => ({
  postGithubComment: (...args: any[]) => mockPostGithubComment(...args),
}));

mock.module("../../utils/github/github-token", () => ({
  getGithubTokenFromThread: (...args: any[]) => mockGetGithubTokenFromThread(...args),
}));

import { githubCommentTool } from "../github-comment";

describe("githubCommentTool", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockPostGithubComment.mockClear();
    mockGetGithubTokenFromThread.mockClear();
    mockPostGithubComment.mockResolvedValue(true);
    mockGetGithubTokenFromThread.mockResolvedValue(["mock_thread_token"]);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const validConfig = {
    configurable: {
      thread_id: "test-thread",
      repo: {
        owner: "test-owner",
        name: "test-repo",
      },
    },
  };

  const validArgs = {
    issue_number: 123,
    body: "Test comment body",
  };

  it("should return error if repo owner is missing", async () => {
    const resultJson = await githubCommentTool.invoke(validArgs, {
      configurable: {
        thread_id: "test-thread",
        repo: { name: "test-repo" },
      },
    } as any);

    const result = JSON.parse(resultJson);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Repository configuration missing.");
  });

  it("should return error if repo name is missing", async () => {
    const resultJson = await githubCommentTool.invoke(validArgs, {
      configurable: {
        thread_id: "test-thread",
        repo: { owner: "test-owner" },
      },
    } as any);

    const result = JSON.parse(resultJson);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Repository configuration missing.");
  });

  it("should use GITHUB_TOKEN from env if available", async () => {
    process.env.GITHUB_TOKEN = "env_token";

    const resultJson = await githubCommentTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson);

    expect(result.success).toBe(true);
    expect(mockPostGithubComment).toHaveBeenCalledWith(
      { owner: "test-owner", name: "test-repo" },
      123,
      "Test comment body",
      "env_token"
    );
    expect(mockGetGithubTokenFromThread).not.toHaveBeenCalled();
  });

  it("should fallback to thread token if GITHUB_TOKEN is missing", async () => {
    delete process.env.GITHUB_TOKEN;

    const resultJson = await githubCommentTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson);

    expect(result.success).toBe(true);
    expect(mockGetGithubTokenFromThread).toHaveBeenCalledWith("test-thread");
    expect(mockPostGithubComment).toHaveBeenCalledWith(
      { owner: "test-owner", name: "test-repo" },
      123,
      "Test comment body",
      "mock_thread_token"
    );
  });

  it("should return error if no token is available", async () => {
    delete process.env.GITHUB_TOKEN;
    mockGetGithubTokenFromThread.mockResolvedValue([]); // No token in thread

    const resultJson = await githubCommentTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing GITHUB_TOKEN");
    expect(mockPostGithubComment).not.toHaveBeenCalled();
  });

  it("should return error if API call fails (returns false)", async () => {
    process.env.GITHUB_TOKEN = "env_token";
    mockPostGithubComment.mockResolvedValue(false);

    const resultJson = await githubCommentTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to post comment. Check logs.");
  });

  it("should return error if API call throws an error", async () => {
    process.env.GITHUB_TOKEN = "env_token";
    mockPostGithubComment.mockRejectedValue(new Error("API rate limit exceeded"));

    const resultJson = await githubCommentTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson);

    expect(result.success).toBe(false);
    expect(result.error).toBe("API rate limit exceeded");
  });
});
