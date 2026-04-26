import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { mergePrTool } from "../merge-pr";

describe("merge_pr tool", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original process.env
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original process.env
    process.env = originalEnv;
    mock.restore();
  });

  it("should return error when repo configuration is missing", async () => {
    const config = {
      configurable: {
        // Missing repo owner and name
      },
    };

    const resultStr = await mergePrTool.invoke({ pr_number: 123 }, config);
    const result = JSON.parse(resultStr);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Repository configuration missing");
  });

  it("should return error when GITHUB_TOKEN is missing", async () => {
    const config = {
      configurable: {
        repo: {
          owner: "testowner",
          name: "testrepo",
        },
      },
    };

    // Remove GITHUB_TOKEN
    delete process.env.GITHUB_TOKEN;

    const resultStr = await mergePrTool.invoke({ pr_number: 123 }, config);
    const result = JSON.parse(resultStr);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing GITHUB_TOKEN");
  });

  it("should successfully merge PR when valid", async () => {
    const config = {
      configurable: {
        repo: {
          owner: "testowner",
          name: "testrepo",
        },
      },
    };

    process.env.GITHUB_TOKEN = "ghp_test_token";

    // mock.module is required here because merge-pr.ts uses a destructured import
    // (import { mergeGithubPr } from "../utils/github") which spyOn cannot intercept
    mock.module("../../utils/github", () => ({
      mergeGithubPr: mock(async () => ({
        merged: true,
        message: "Pull Request successfully merged",
        sha: "abcdef123456",
      })),
    }));

    const { mergePrTool: freshTool } = await import("../merge-pr");
    const resultStr = await freshTool.invoke({ pr_number: 123 }, config);
    // Strip citation reminder before parsing
    const jsonPart = resultStr.match(/^\{[\s\S]*?\}/)?.[0] ?? resultStr;
    const result = JSON.parse(jsonPart);

    expect(result.success).toBe(true);
    expect(result.merged).toBe(true);
    expect(result.message).toBe("Pull Request successfully merged");
    expect(result.sha).toBe("abcdef123456");
  });

  it("should handle failed PR merge gracefully", async () => {
    const config = {
      configurable: {
        repo: {
          owner: "testowner",
          name: "testrepo",
        },
      },
    };

    process.env.GITHUB_TOKEN = "ghp_test_token";

    const error: any = new Error("Merge conflict");
    error.status = 405;
    error.response = {
      data: {
        message: "Pull Request is not mergeable",
      },
    };
    mock.module("../../utils/github", () => ({
      mergeGithubPr: mock(async () => { throw error; }),
    }));

    const { mergePrTool: freshTool } = await import("../merge-pr");
    const resultStr = await freshTool.invoke({ pr_number: 123 }, config);
    const result = JSON.parse(resultStr);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Pull Request is not mergeable");
    expect(result.status).toBe(405);
    expect(result.pr_number).toBe(123);
  });
});

