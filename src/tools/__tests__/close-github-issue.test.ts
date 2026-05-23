import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spyOn } from "bun:test";
import * as github from "../../utils/github";
import { closeGithubIssueTool } from "../close-github-issue";

describe("closeGithubIssueTool", () => {
  const originalEnv = process.env;
  let mockCloseGithubIssue: any;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockCloseGithubIssue = spyOn(github, "closeGithubIssue").mockResolvedValue({
      url: "https://github.com/test-owner/test-repo/issues/42",
      number: 42,
      state: "closed",
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    if (mockCloseGithubIssue) mockCloseGithubIssue.mockRestore();
  });

  const validConfig = {
    configurable: {
      thread_id: "test-thread",
      repo: { owner: "test-owner", name: "test-repo" },
    },
  };

  const validArgs = { issue_number: 42 };

  it("should return error if repo owner is missing", async () => {
    const resultJson = await closeGithubIssueTool.invoke(validArgs, {
      configurable: {
        thread_id: "test-thread",
        repo: { name: "test-repo" },
      },
    } as any);

    const result = JSON.parse(resultJson as string);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Repository configuration missing");
  });

  it("should return error if repo name is missing", async () => {
    const resultJson = await closeGithubIssueTool.invoke(validArgs, {
      configurable: {
        thread_id: "test-thread",
        repo: { owner: "test-owner" },
      },
    } as any);

    const result = JSON.parse(resultJson as string);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Repository configuration missing");
  });

  it("should return error if GITHUB_TOKEN is missing", async () => {
    delete process.env.GITHUB_TOKEN;

    const resultJson = await closeGithubIssueTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing GITHUB_TOKEN");
    expect(mockCloseGithubIssue).not.toHaveBeenCalled();
  });

  it("should close issue with GITHUB_TOKEN from env", async () => {
    process.env.GITHUB_TOKEN = "env_token";

    const resultJson = await closeGithubIssueTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse((resultJson as string).split('\n\nIMPORTANT:')[0]);

    expect(result.success).toBe(true);
    expect(result.issue_url).toBe("https://github.com/test-owner/test-repo/issues/42");
    expect(result.issue_number).toBe(42);
    expect(result.state).toBe("closed");
    expect(mockCloseGithubIssue).toHaveBeenCalledWith(
      "test-owner",
      "test-repo",
      "env_token",
      42,
    );
  });

  it("should include citation reminder in response", async () => {
    process.env.GITHUB_TOKEN = "env_token";

    const resultJson = await closeGithubIssueTool.invoke(validArgs, validConfig as any);

    expect(resultJson).toContain("IMPORTANT: When responding to the user");
    expect(resultJson).toContain("Issue #42");
    expect(resultJson).toContain("https://github.com/test-owner/test-repo/issues/42");
  });

  it("should return error if API call throws", async () => {
    process.env.GITHUB_TOKEN = "env_token";
    mockCloseGithubIssue.mockRejectedValue(new Error("Not Found"));

    const resultJson = await closeGithubIssueTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Not Found");
  });

  it("should extract status from error if available", async () => {
    process.env.GITHUB_TOKEN = "env_token";
    const error: any = new Error("Unauthorized");
    error.status = 401;
    mockCloseGithubIssue.mockRejectedValue(error);

    const resultJson = await closeGithubIssueTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
  });
});
