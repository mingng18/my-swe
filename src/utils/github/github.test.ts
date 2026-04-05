import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import type { SandboxService } from "../../integrations/sandbox-service";

const pullsCreateMock = mock(() => Promise.resolve({ data: {} }));
const pullsListMock = mock(() => Promise.resolve({ data: [] }));
const reposGetMock = mock(() =>
  Promise.resolve({ data: { default_branch: "main" } }),
);

mock.module("octokit", () => ({
  Octokit: class {
    rest = {
      pulls: {
        create: pullsCreateMock,
        list: pullsListMock,
      },
      repos: {
        get: reposGetMock,
      },
    };
  },
}));

interface FakeExecuteResponse {
  exitCode?: number;
  output: string;
  error?: string;
}

class FakeSandbox {
  constructor(private readonly responses: FakeExecuteResponse[]) {}

  async execute(_command: string): Promise<FakeExecuteResponse> {
    const next = this.responses.shift();
    return next ?? { exitCode: 0, output: "" };
  }

  async write(_filePath: string, _content: string): Promise<void> {
    return;
  }
}

describe("github utils", () => {
  test("gitRemoteBranchExists returns true when ls-remote succeeds", async () => {
    const backend = new FakeSandbox([
      { exitCode: 0, output: "sha\trefs/heads/feat" },
    ]);
    const { gitRemoteBranchExists } = await import("./github");
    const exists = await gitRemoteBranchExists(
      backend as unknown as SandboxService,
      "/tmp/repo",
      "feat",
    );
    expect(exists).toBe(true);
  });

  test("gitPush throws when git push exits non-zero", async () => {
    const backend = new FakeSandbox([
      { exitCode: 1, output: "permission denied" },
    ]);
    const { gitPush } = await import("./github");
    await expect(
      gitPush(backend as unknown as SandboxService, "/tmp/repo", "feat"),
    ).rejects.toThrow("Git command failed");
  });

  test("gitPush strips trailing slashes from remote URL", async () => {
    // Simulate git remote get-url returning URL with trailing slash
    const backend = new FakeSandbox([
      { exitCode: 0, output: "https://github.com/owner/repo.git/\n" }, // git remote get-url (with trailing /)
      { exitCode: 0, output: "" }, // git remote set-url
      { exitCode: 0, output: "" }, // git push
      { exitCode: 0, output: "" }, // git remote set-url (restore)
    ]);
    const { gitPush } = await import("./github");
    const result = await gitPush(
      backend as unknown as SandboxService,
      "/tmp/repo",
      "feat",
      "test-token",
    );
    // Should succeed without throwing
    expect(result).toBeDefined();
  });
});

describe("createGithubPr", () => {
  let createGithubPr: typeof import("./github").createGithubPr;

  beforeEach(async () => {
    // Reset mocks
    pullsCreateMock.mockReset();
    pullsListMock.mockReset();
    reposGetMock.mockReset();

    // Import dynamically after mocking
    const module = await import("./github");
    createGithubPr = module.createGithubPr;
  });

  test("retries with plain head branch when github returns 422 with field:head", async () => {
    reposGetMock.mockResolvedValue({
      data: {
        default_branch: "main",
        parent: undefined,
      },
    });

    pullsCreateMock.mockImplementationOnce(() => {
      const error = new Error("Validation Failed");
      Object.assign(error, {
        status: 422,
        response: { errors: [{ field: "head" }] },
      });
      return Promise.reject(error);
    });

    pullsCreateMock.mockImplementationOnce(() => {
      return Promise.resolve({
        data: {
          html_url: "https://github.com/owner/repo/pull/1",
          number: 1,
          base: { ref: "main" },
          head: {
            ref: "feature",
            label: "feature",
            repo: { full_name: "owner/repo" },
          },
        },
      });
    });

    const result = await createGithubPr(
      "headOwner",
      "headRepo",
      "token",
      "PR Title",
      "feature",
      "PR Body",
    );

    expect(result).toEqual(["https://github.com/owner/repo/pull/1", 1, false]);
    expect(pullsCreateMock).toHaveBeenCalledTimes(2);
    expect(pullsCreateMock.mock.calls[0][0].head).toBe("headOwner:feature");
    expect(pullsCreateMock.mock.calls[1][0].head).toBe("feature");
  });

  test("falls back to finding existing PR when 422 does not include field:head", async () => {
    reposGetMock.mockResolvedValue({
      data: {
        default_branch: "main",
        parent: undefined,
      },
    });

    pullsCreateMock.mockImplementationOnce(() => {
      const error = new Error("Validation Failed");
      Object.assign(error, {
        status: 422,
        response: { errors: [{ field: "other" }] },
      });
      return Promise.reject(error);
    });

    pullsListMock.mockImplementationOnce(() => {
      return Promise.resolve({
        data: [{ html_url: "https://github.com/owner/repo/pull/2", number: 2 }],
      });
    });

    const result = await createGithubPr(
      "headOwner",
      "headRepo",
      "token",
      "PR Title",
      "feature",
      "PR Body",
    );

    expect(result).toEqual(["https://github.com/owner/repo/pull/2", 2, true]);
    expect(pullsCreateMock).toHaveBeenCalledTimes(1);
    expect(pullsListMock).toHaveBeenCalledTimes(1);
    expect(pullsListMock.mock.calls[0][0].head).toBe("headOwner:feature");
  });

  test("falls back to finding existing PR when retry with plain head branch also throws 422", async () => {
    reposGetMock.mockResolvedValue({
      data: {
        default_branch: "main",
        parent: undefined,
      },
    });

    pullsCreateMock.mockImplementationOnce(() => {
      const error = new Error("Validation Failed");
      Object.assign(error, {
        status: 422,
        response: { errors: [{ field: "head" }] },
      });
      return Promise.reject(error);
    });

    pullsCreateMock.mockImplementationOnce(() => {
      const error = new Error("Validation Failed Again");
      Object.assign(error, {
        status: 422,
        response: { errors: [{ field: "other" }] },
      });
      return Promise.reject(error);
    });

    pullsListMock.mockImplementationOnce(() => {
      return Promise.resolve({
        data: [{ html_url: "https://github.com/owner/repo/pull/3", number: 3 }],
      });
    });

    const result = await createGithubPr(
      "headOwner",
      "headRepo",
      "token",
      "PR Title",
      "feature",
      "PR Body",
    );

    expect(result).toEqual(["https://github.com/owner/repo/pull/3", 3, true]);
    expect(pullsCreateMock).toHaveBeenCalledTimes(2);
    expect(pullsListMock).toHaveBeenCalledTimes(1);
    expect(pullsListMock.mock.calls[0][0].head).toBe("headOwner:feature");
  });
});
