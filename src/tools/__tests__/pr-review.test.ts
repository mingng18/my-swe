import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";

// Capture the REAL shared modules BEFORE any mock.module call below. Bun's
// mock.module replaces a module process-wide: a partial factory that only
// exposes the handful of exports pr-review needs (postGithubComment,
// cachedGithubApiCall) strips every OTHER named export for any sibling test
// file loaded in the same process that imports the same absolute path
// (github-cache reads the real cachedGithubApiCall). Spread the real module in
// each factory so the mock is a superset and override only the specific export
// pr-review needs.
//
// For reviewerMapping + registry we go further: pr-review needs to control
// getReviewersForFiles' return value and (historically) builtInSubagents, but
// those are LIVE BINDINGS consumed by sibling test files
// (reviewerMapping.test.ts, registry.test.ts). Overriding them via mock.module
// — even with a spread — replaces the binding process-wide and breaks those
// siblings ("Received: 1" for builtInSubagents.length, empty REVIEWER_MAPPINGS
// for getReviewersForFile). So we do NOT mock those modules at all: instead we
// spyOn the real getReviewersForFiles (auto-restored per test, no process-wide
// pollution) and rely on the REAL builtInSubagents (which already contains
// code-reviewer/security-reviewer). sandboxState is also intentionally NOT
// mocked (real getSandboxBackendSync("test-thread") already returns null).
// (Pattern from commits ca85e58/efdf23c.)
import * as realReviewerMapping from "../../subagents/reviewerMapping";
import * as realGithubIndex from "../../utils/github/index";
import * as realGithubCache from "../../utils/github/github-cache";

describe("prReviewTool", () => {
  const originalEnv = process.env;
  let reviewersSpy: ReturnType<typeof spyOn>;
  let cacheSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    process.env = { ...originalEnv };

    // Control which reviewers pr-review selects WITHOUT mocking the module
    // process-wide. spyOn replaces the live binding for the duration of each
    // test and is auto-restored in afterEach, so sibling reviewerMapping tests
    // always see the real getReviewersForFiles.
    reviewersSpy = spyOn(realReviewerMapping, "getReviewersForFiles").mockReturnValue(
      ["code-reviewer"] as any,
    );

    // NOTE: we intentionally do NOT mock ../../utils/sandboxState here.
    // pr-review uses getSandboxBackendSync("test-thread"), and the REAL
    // implementation already returns null for that thread (nothing sets a
    // backend for it in these tests). Mocking sandboxState process-wide — even
    // with a spread — would override getSandboxBackendSync for sibling files
    // (code-search.test.ts) that rely on the real setSandboxBackend/
    // getSandboxBackendSync pair, breaking them. Leaving the real module in
    // place satisfies pr-review (null for "test-thread") without pollution.

    // Mock postGithubComment (spread real so sibling github tests keep exports)
    mock.module("../../utils/github/index", () => ({
      ...realGithubIndex,
      postGithubComment: mock(async () => true),
    }));

    // NOTE: we intentionally do NOT mock ../../subagents/registry. pr-review
    // needs the code-reviewer config, which already exists in the REAL
    // builtInSubagents. Mocking registry process-wide — even with a spread —
    // replaces builtInSubagents and breaks sibling registry.test.ts /
    // subagents.integration.test.ts ("Received: 1" vs expected 11).

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

    // Control cachedGithubApiCall (used by fetchPrFiles) via spyOn on the real
    // module (per-test, auto-restored). A mock.module override here would
    // replace cachedGithubApiCall process-wide and break sibling
    // github-cache.test.ts, which imports the real cachedGithubApiCall to test
    // caching behavior. The spy returns mock PR files by default; individual
    // tests override via cacheSpy.mockImplementation.
    cacheSpy = spyOn(realGithubCache, "cachedGithubApiCall").mockImplementation(
      async (_method: string, _endpoint: string, _params: any, _callback: any) => ({
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
      }) as any,
    );

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

    // Override getReviewersForFiles to return empty array via spyOn (per-test,
    // auto-restored — no process-wide mock.module pollution)
    reviewersSpy.mockReturnValue([] as any);

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

    // cachedGithubApiCall returns files without patches (spy, not mock.module)
    cacheSpy.mockImplementation(
      async (_method: string, _endpoint: string, _params: any, _callback: any) => ({
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
      }) as any,
    );

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

    // Mock postGithubComment to return false (spread real)
    mock.module("../../utils/github/index", () => ({
      ...realGithubIndex,
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

    // Mock postGithubComment to throw error (spread real)
    mock.module("../../utils/github/index", () => ({
      ...realGithubIndex,
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

    // cachedGithubApiCall throws (spy, not mock.module)
    cacheSpy.mockImplementation(
      async () => {
        throw new Error("API rate limit exceeded");
      },
    );

    const { prReviewTool } = await import("../pr-review");

    const resultJson = await prReviewTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(false);
    expect(result.error).toBe("API rate limit exceeded");
  });

  it("should aggregate issues from multiple reviewers", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    // Override getReviewersForFiles to return multiple reviewers via spyOn
    // (per-test, auto-restored). The REAL builtInSubagents already contains
    // both code-reviewer and security-reviewer configs, so no registry mock.
    reviewersSpy.mockReturnValue(["code-reviewer", "security-reviewer"] as any);

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
  let fetchCacheSpy: ReturnType<typeof spyOn>;

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

    // cachedGithubApiCall delegates to its callback (the real Octokit call,
    // which is mocked above). Use spyOn (per-test, auto-restored) instead of
    // mock.module so sibling github-cache.test.ts keeps the real
    // cachedGithubApiCall / invalidateRepoCache / invalidatePrCache exports.
    fetchCacheSpy = spyOn(realGithubCache, "cachedGithubApiCall").mockImplementation(
      async (_method: string, _endpoint: string, _params: any, callback: any) =>
        await callback(),
    );
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
