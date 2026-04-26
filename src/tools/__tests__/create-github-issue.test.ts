import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

let mockCreateGithubIssue = mock().mockResolvedValue([
  "https://github.com/test-owner/test-repo/issues/123",
  123,
]);

mock.module("../../utils/github", () => ({
  createGithubIssue: (...args: any[]) => mockCreateGithubIssue(...args),
}));

import { createGithubIssueTool } from "../create-github-issue";

describe("createGithubIssueTool", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockCreateGithubIssue.mockClear();
    mockCreateGithubIssue.mockResolvedValue([
      "https://github.com/test-owner/test-repo/issues/123",
      123,
    ]);
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
    title: "Test Issue Title",
    body: "Test issue body",
  };

  it("should return error if repo owner is missing", async () => {
    const resultJson = await createGithubIssueTool.invoke(validArgs, {
      configurable: {
        thread_id: "test-thread",
        repo: { name: "test-repo" },
      },
    } as any);

    const result = JSON.parse(resultJson);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Repository configuration missing");
  });

  it("should return error if repo name is missing", async () => {
    const resultJson = await createGithubIssueTool.invoke(validArgs, {
      configurable: {
        thread_id: "test-thread",
        repo: { owner: "test-owner" },
      },
    } as any);

    const result = JSON.parse(resultJson);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Repository configuration missing");
  });

  it("should return error if GITHUB_TOKEN is missing", async () => {
    delete process.env.GITHUB_TOKEN;

    const resultJson = await createGithubIssueTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing GITHUB_TOKEN");
    expect(mockCreateGithubIssue).not.toHaveBeenCalled();
  });

  it("should create issue with GITHUB_TOKEN from env", async () => {
    process.env.GITHUB_TOKEN = "env_token";

    const resultJson = await createGithubIssueTool.invoke(validArgs, validConfig as any);
    // Extract JSON part (before the citation reminder)
    const jsonMatch = resultJson.match(/\{[\s\S]*?\}/);
    const result = JSON.parse(jsonMatch ? jsonMatch[0] : resultJson);

    expect(result.success).toBe(true);
    expect(result.issue_url).toBe("https://github.com/test-owner/test-repo/issues/123");
    expect(result.issue_number).toBe(123);
    expect(result.title).toBe("Test Issue Title");
    expect(mockCreateGithubIssue).toHaveBeenCalledWith(
      "test-owner",
      "test-repo",
      "env_token",
      "Test Issue Title",
      "Test issue body"
    );
  });

  it("should include citation reminder in response", async () => {
    process.env.GITHUB_TOKEN = "env_token";

    const resultJson = await createGithubIssueTool.invoke(validArgs, validConfig as any);

    expect(resultJson).toContain("IMPORTANT: When responding to the user");
    expect(resultJson).toContain("Issue #123");
    expect(resultJson).toContain("https://github.com/test-owner/test-repo/issues/123");
  });

  it("should return error if API call returns no URL or number", async () => {
    process.env.GITHUB_TOKEN = "env_token";
    mockCreateGithubIssue.mockResolvedValue([null, null]);

    const resultJson = await createGithubIssueTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to create issue. No URL or number returned");
  });

  it("should return error if API call throws an error", async () => {
    process.env.GITHUB_TOKEN = "env_token";
    mockCreateGithubIssue.mockRejectedValue(new Error("API rate limit exceeded"));

    const resultJson = await createGithubIssueTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson);

    expect(result.success).toBe(false);
    expect(result.error).toBe("API rate limit exceeded");
  });

  it("should extract status from error if available", async () => {
    process.env.GITHUB_TOKEN = "env_token";
    const error: any = new Error("Unauthorized");
    error.status = 401;
    error.response = {
      data: {
        message: "Bad credentials",
      },
    };
    mockCreateGithubIssue.mockRejectedValue(error);

    const resultJson = await createGithubIssueTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Bad credentials");
    expect(result.status).toBe(401);
    expect(result.title).toBe("Test Issue Title");
  });

  it("should extract status from response.status if error.status is missing", async () => {
    process.env.GITHUB_TOKEN = "env_token";
    const error: any = new Error("Forbidden");
    error.response = {
      status: 403,
      data: {
        message: "Resource not accessible",
      },
    };
    mockCreateGithubIssue.mockRejectedValue(error);

    const resultJson = await createGithubIssueTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson);

    expect(result.success).toBe(false);
    expect(result.status).toBe(403);
  });

  it("should handle errors with minimal information", async () => {
    process.env.GITHUB_TOKEN = "env_token";
    mockCreateGithubIssue.mockRejectedValue(new Error("Unknown error"));

    const resultJson = await createGithubIssueTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unknown error");
    expect(result.status).toBeNull();
  });
});
