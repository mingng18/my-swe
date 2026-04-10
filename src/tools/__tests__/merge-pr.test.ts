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

    // Mock mergeGithubPr to succeed
    mock.module("../utils/github", () => ({
      mergeGithubPr: mock(async () => {
        return {
          merged: true,
          message: "Pull Request successfully merged",
          sha: "abcdef123456",
        };
      }),
    }));

    // Import the tool after mocking
    const { mergePrTool: mockMergePrTool } = await import("../merge-pr");

    const resultStr = await mockMergePrTool.invoke({ pr_number: 123 }, config);
    const result = JSON.parse(resultStr);

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

    // Mock mergeGithubPr to fail
    mock.module("../utils/github", () => ({
      mergeGithubPr: mock(async () => {
        const error: any = new Error("Merge conflict");
        error.status = 405;
        error.response = {
          data: {
            message: "Pull Request is not mergeable",
          },
        };
        throw error;
      }),
    }));

    // Import the tool after mocking
    const { mergePrTool: mockMergePrTool } = await import("../merge-pr");

    const resultStr = await mockMergePrTool.invoke({ pr_number: 123 }, config);
    const result = JSON.parse(resultStr);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Pull Request is not mergeable");
    expect(result.status).toBe(405);
    expect(result.pr_number).toBe(123);
  });
});
