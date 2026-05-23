import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spyOn } from "bun:test";
import * as github from "../../utils/github";
import { reopenGithubIssueTool } from "../reopen-github-issue";

describe("reopenGithubIssueTool", () => {
  const originalEnv = process.env;
  let mockReopenGithubIssue: any;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockReopenGithubIssue = spyOn(github, "reopenGithubIssue").mockResolvedValue({
      url: "https://github.com/test-owner/test-repo/issues/42",
      number: 42,
      state: "open",
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    if (mockReopenGithubIssue) mockReopenGithubIssue.mockRestore();
  });

  const validConfig = {
    configurable: {
      thread_id: "test-thread",
      repo: { owner: "test-owner", name: "test-repo" },
    },
  };

  const validArgs = { issue_number: 42 };

  it("should return error if repo config is missing", async () => {
    const resultJson = await reopenGithubIssueTool.invoke(validArgs, {
      configurable: { thread_id: "test-thread" },
    } as any);

    const result = JSON.parse(resultJson as string);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Repository configuration missing");
  });

  it("should return error if GITHUB_TOKEN is missing", async () => {
    delete process.env.GITHUB_TOKEN;

    const resultJson = await reopenGithubIssueTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing GITHUB_TOKEN");
    expect(mockReopenGithubIssue).not.toHaveBeenCalled();
  });

  it("should reopen issue with GITHUB_TOKEN from env", async () => {
    process.env.GITHUB_TOKEN = "env_token";

    const resultJson = await reopenGithubIssueTool.invoke(validArgs, validConfig as any);
    const jsonMatch = (resultJson as string).match(/\{[\s\S]*?\}/);
    const result = JSON.parse(jsonMatch ? jsonMatch[0] : (resultJson as string));

    expect(result.success).toBe(true);
    expect(result.issue_number).toBe(42);
    expect(result.state).toBe("open");
    expect(mockReopenGithubIssue).toHaveBeenCalledWith(
      "test-owner",
      "test-repo",
      "env_token",
      42,
    );
  });

  it("should include citation reminder in response", async () => {
    process.env.GITHUB_TOKEN = "env_token";

    const resultJson = await reopenGithubIssueTool.invoke(validArgs, validConfig as any);

    expect(resultJson).toContain("IMPORTANT: When responding to the user");
    expect(resultJson).toContain("Issue #42");
  });

  it("should return error if API call throws", async () => {
    process.env.GITHUB_TOKEN = "env_token";
    mockReopenGithubIssue.mockRejectedValue(new Error("Not Found"));

    const resultJson = await reopenGithubIssueTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Not Found");
  });
});
