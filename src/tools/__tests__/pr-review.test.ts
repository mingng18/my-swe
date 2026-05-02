import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

describe("prReviewTool", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };

    // Mock getReviewersForFiles
    mock.module("../../subagents/reviewerMapping", () => ({
      getReviewersForFiles: mock(() => ["code-reviewer"]),
      REVIEWER_MAPPINGS: [],
    }));

    // Mock getSandboxBackendSync
    mock.module("../../utils/sandboxState", () => ({
      getSandboxBackendSync: mock(() => null),
    }));

    // Mock postGithubComment
    mock.module("../../utils/github/index", () => ({
      postGithubComment: mock(async () => true),
    }));

    // Mock builtInSubagents
    mock.module("../../subagents/registry", () => ({
      builtInSubagents: [
        {
          name: "code-reviewer",
          systemPrompt: "You are a code reviewer",
          tools: [],
          model: "sonnet",
        },
      ],
    }));

    // Mock createDeepAgent
    mock.module("deepagents", () => ({
      createDeepAgent: mock(() => ({
        invoke: mock(async () => ({
          messages: [
            {
              role: "assistant",
              content: `[MEDIUM]
File: src/test.ts
Issue: Test issue
Fix: Fix the issue`,
            },
          ],
        })),
      })),
    }));

    // Mock cachedGithubApiCall and fetchPrFiles
    mock.module("../../utils/github/github-cache", () => ({
      cachedGithubApiCall: mock(async (method, endpoint, params, callback) => {
        // Return mock PR files
        return {
          data: [
            {
              filename: "src/test.ts",
              status: "modified",
              additions: 10,
              deletions: 5,
              changes: 15,
              patch: "@@ -1,5 +1,10 @@\n+export function test() {\n+  return true;\n+}",
            },
          ],
        };
      }),
    }));

    // Mock Octokit
    mock.module("octokit", () => ({
      Octokit: mock(() => ({
        rest: {
          pulls: {
            listFiles: mock(async () => ({
              data: [
                {
                  filename: "src/test.ts",
                  status: "modified",
                  additions: 10,
                  deletions: 5,
                  changes: 15,
                  patch: "@@ -1,5 +1,10 @@\n+export function test() {\n+  return true;\n+}",
                },
              ],
            })),
          },
        },
      })),
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
    mock.restore();
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
    pr_number: 123,
  };

  it("should return error if repo owner is missing", async () => {
    const { prReviewTool } = await import("../pr-review");

    const resultJson = await prReviewTool.invoke(validArgs, {
      configurable: {
        thread_id: "test-thread",
        repo: { name: "test-repo" },
      },
    } as any);

    const result = JSON.parse(resultJson as string);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Repository configuration missing.");
  });

  it("should return error if repo name is missing", async () => {
    const { prReviewTool } = await import("../pr-review");

    const resultJson = await prReviewTool.invoke(validArgs, {
      configurable: {
        thread_id: "test-thread",
        repo: { owner: "test-owner" },
      },
    } as any);

    const result = JSON.parse(resultJson as string);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Repository configuration missing.");
  });

  it("should return error if thread_id is missing", async () => {
    const { prReviewTool } = await import("../pr-review");

    const resultJson = await prReviewTool.invoke(validArgs, {
      configurable: {
        repo: {
          owner: "test-owner",
          name: "test-repo",
        },
      },
    } as any);

    const result = JSON.parse(resultJson as string);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Missing thread_id in config");
  });

  it("should return error if GITHUB_TOKEN is missing", async () => {
    delete process.env.GITHUB_TOKEN;
    const { prReviewTool } = await import("../pr-review");

    const resultJson = await prReviewTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(false);
    expect(result.error).toBe("GITHUB_TOKEN environment variable not set");
  });

  it("should return success message if no applicable reviewers found", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    // Override getReviewersForFiles to return empty array
    mock.module("../../subagents/reviewerMapping", () => ({
      getReviewersForFiles: mock(() => []),
      REVIEWER_MAPPINGS: [],
    }));

    const { prReviewTool } = await import("../pr-review");

    const resultJson = await prReviewTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(true);
    expect(result.message).toBe("No applicable reviewers found for the files in this PR");
    expect(result.issues).toEqual([]);
    expect(result.has_critical).toBe(false);
  });

  it("should return success message if no file patches available", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    // Mock cachedGithubApiCall to return files without patches
    mock.module("../../utils/github/github-cache", () => ({
      cachedGithubApiCall: mock(async (method, endpoint, params, callback) => {
        return {
          data: [
            {
              filename: "src/test.ts",
              status: "modified",
              additions: 10,
              deletions: 5,
              changes: 15,
              patch: null,
            },
          ],
        };
      }),
    }));

    const { prReviewTool } = await import("../pr-review");

    const resultJson = await prReviewTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(true);
    expect(result.message).toBe("No file patches available for review (files may be binary or too large)");
    expect(result.issues).toEqual([]);
    expect(result.has_critical).toBe(false);
  });

  it("should successfully run reviewers and post comment", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    const { prReviewTool } = await import("../pr-review");

    const resultJson = await prReviewTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(true);
    expect(result.comment_posted).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      severity: "MEDIUM",
      file: "src/test.ts",
      issue: "Test issue",
      fix: "Fix the issue",
    });
  });

  it("should handle reviewer execution errors gracefully", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    // Mock createDeepAgent to throw error
    mock.module("deepagents", () => ({
      createDeepAgent: mock(() => ({
        invoke: mock(async () => {
          throw new Error("Reviewer execution failed");
        }),
      })),
    }));

    const { prReviewTool } = await import("../pr-review");

    const resultJson = await prReviewTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(true); // Overall success even if reviewer fails
    expect(result.reviewer_results).toHaveLength(1);
    expect(result.reviewer_results[0].status).toBe("error");
    expect(result.reviewer_results[0].error).toBe("Reviewer execution failed");
  });

  it("should handle errors when posting comment", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    // Mock postGithubComment to return false
    mock.module("../../utils/github/index", () => ({
      postGithubComment: mock(async () => false),
    }));

    const { prReviewTool } = await import("../pr-review");

    const resultJson = await prReviewTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(true); // Review succeeded, comment posting failed
    expect(result.comment_posted).toBe(false);
    expect(result.comment_error).toBe("Failed to post comment (check logs)");
  });

  it("should handle exceptions when posting comment", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    // Mock postGithubComment to throw error
    mock.module("../../utils/github/index", () => ({
      postGithubComment: mock(async () => {
        throw new Error("Network error");
      }),
    }));

    const { prReviewTool } = await import("../pr-review");

    const resultJson = await prReviewTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(true); // Review succeeded, comment posting failed
    expect(result.comment_posted).toBe(false);
    expect(result.comment_error).toBe("Network error");
  });

  it("should handle API errors when fetching PR files", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    // Mock cachedGithubApiCall to throw error
    mock.module("../../utils/github/github-cache", () => ({
      cachedGithubApiCall: mock(async (method, endpoint, params, callback) => {
        throw new Error("API rate limit exceeded");
      }),
    }));

    const { prReviewTool } = await import("../pr-review");

    const resultJson = await prReviewTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(false);
    expect(result.error).toBe("API rate limit exceeded");
  });

  it("should aggregate issues from multiple reviewers", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    // Override getReviewersForFiles to return multiple reviewers
    mock.module("../../subagents/reviewerMapping", () => ({
      getReviewersForFiles: mock(() => ["code-reviewer", "security-reviewer"]),
      REVIEWER_MAPPINGS: [],
    }));

    // Mock builtInSubagents with multiple reviewers
    mock.module("../../subagents/registry", () => ({
      builtInSubagents: [
        {
          name: "code-reviewer",
          systemPrompt: "You are a code reviewer",
          tools: [],
          model: "sonnet",
        },
        {
          name: "security-reviewer",
          systemPrompt: "You are a security reviewer",
          tools: [],
          model: "sonnet",
        },
      ],
    }));

    // Mock createDeepAgent to return different issues for each reviewer
    let callCount = 0;
    mock.module("deepagents", () => ({
      createDeepAgent: mock((options: any) => {
        callCount++;
        if (options.name === "code-reviewer") {
          return {
            invoke: mock(async () => ({
              messages: [
                {
                  role: "assistant",
                  content: `[MEDIUM]
File: src/test.ts
Issue: Code quality issue
Fix: Refactor code`,
                },
              ],
            })),
          };
        } else {
          return {
            invoke: mock(async () => ({
              messages: [
                {
                  role: "assistant",
                  content: `[HIGH]
File: src/auth.ts
Issue: Security vulnerability
Fix: Add validation`,
                },
              ],
            })),
          };
        }
      }),
    }));

    const { prReviewTool } = await import("../pr-review");

    const resultJson = await prReviewTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(2);
    expect(result.reviewer_results).toHaveLength(2);
    expect(result.comment_posted).toBe(true);
  });

  it("should detect critical issues", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    // Mock createDeepAgent to return critical issue
    mock.module("deepagents", () => ({
      createDeepAgent: mock(() => ({
        invoke: mock(async () => ({
          messages: [
            {
              role: "assistant",
              content: `[CRITICAL]
File: src/test.ts
Issue: Critical issue
Fix: Fix immediately`,
            },
          ],
        })),
      })),
    }));

    const { prReviewTool } = await import("../pr-review");

    const resultJson = await prReviewTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(true);
    expect(result.has_critical).toBe(true);
    expect(result.issues[0].severity).toBe("CRITICAL");
  });
});

describe("fetchPrFiles", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };

    // Mock Octokit
    mock.module("octokit", () => ({
      Octokit: mock(() => ({
        rest: {
          pulls: {
            listFiles: mock(async () => ({
              data: [
                {
                  filename: "src/test.ts",
                  status: "modified",
                  additions: 10,
                  deletions: 5,
                  changes: 15,
                  patch: "@@ -1,5 +1,10 @@\n+export function test() {\n+  return true;\n+}",
                },
              ],
            })),
          },
        },
      })),
    }));

    // Mock cachedGithubApiCall
    mock.module("../../utils/github/github-cache", () => ({
      cachedGithubApiCall: mock(async (method, endpoint, params, callback) => {
        return await callback();
      }),
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
    mock.restore();
  });

  it("should fetch PR files successfully", async () => {
    const { fetchPrFiles } = await import("../pr-review");

    const files = await fetchPrFiles("test-owner", "test-repo", 123, "test-token");

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      filename: "src/test.ts",
      status: "modified",
      additions: 10,
      deletions: 5,
      changes: 15,
      patch: "@@ -1,5 +1,10 @@\n+export function test() {\n+  return true;\n+}",
    });
  });

  it("should handle files without patch", async () => {
    // Mock Octokit to return files without patch
    mock.module("octokit", () => ({
      Octokit: mock(() => ({
        rest: {
          pulls: {
            listFiles: mock(async () => ({
              data: [
                {
                  filename: "src/binary.png",
                  status: "added",
                  additions: 0,
                  deletions: 0,
                  changes: 1,
                  patch: null,
                },
              ],
            })),
          },
        },
      })),
    }));

    const { fetchPrFiles } = await import("../pr-review");

    const files = await fetchPrFiles("test-owner", "test-repo", 123, "test-token");

    expect(files).toHaveLength(1);
    expect(files[0].patch).toBeUndefined();
  });

  it("should throw error when API call fails", async () => {
    // Mock Octokit to throw error
    mock.module("octokit", () => ({
      Octokit: mock(() => ({
        rest: {
          pulls: {
            listFiles: mock(async () => {
              throw new Error("API error");
            }),
          },
        },
      })),
    }));

    const { fetchPrFiles } = await import("../pr-review");

    await expect(
      fetchPrFiles("test-owner", "test-repo", 123, "test-token")
    ).rejects.toThrow("API error");
  });
});
