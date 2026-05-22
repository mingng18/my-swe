import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import type { SandboxService } from "../../integrations/sandbox-service";
import { githubApiCache } from "./github-cache";

const pullsCreateMock = mock(() => Promise.resolve({ data: {} })) as any;
const pullsListMock = mock(() => Promise.resolve({ data: [] })) as any;
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
    // paginate delegates to the underlying method so mock data flows through
    async paginate(fn: any, params: any) {
      const result = await fn(params);
      return result?.data ?? [];
    }
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
    // Clear the in-process cache so tests don't bleed into each other
    githubApiCache.clear();
    // Default: list returns empty so pre-checks don't find phantom PRs
    pullsListMock.mockResolvedValue({ data: [] });

    // Import dynamically after mocking
    const module = await import("./github");
    createGithubPr = module.createGithubPr;
  });

  test("retries with plain head branch when github returns 422 with field:head", async () => {
    reposGetMock.mockResolvedValue({
      data: {
        default_branch: "main",
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
    expect((pullsCreateMock.mock.calls[0]![0] as any).head).toBe("headOwner:feature");
    expect((pullsCreateMock.mock.calls[1]![0] as any).head).toBe("feature");
  });

  test("falls back to finding existing PR when 422 does not include field:head", async () => {
    reposGetMock.mockResolvedValue({
      data: {
        default_branch: "main",

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

    // First two list calls are the pre-check (uses default empty from beforeEach)
    // Override for the post-422 fallback search
    let callCount = 0;
    pullsListMock.mockImplementation((params: any) => {
      callCount++;
      if (callCount <= 2) {
        // Pre-check: return empty so creation is attempted
        return Promise.resolve({ data: [] });
      }
      // Post-422 fallback: return the existing PR
      return Promise.resolve({
        data: [{ html_url: "https://github.com/owner/repo/pull/2", number: 2, head: { ref: "feature", repo: { full_name: "headOwner/headRepo" } } }],
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
    expect(pullsListMock).toHaveBeenCalledTimes(4); // 2 pre-check + 2 post-422 fallback
  });

  test("falls back to finding existing PR when retry with plain head branch also throws 422", async () => {
    reposGetMock.mockResolvedValue({
      data: {
        default_branch: "main",

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

    // First two list calls are the pre-check (uses default empty from beforeEach)
    // Override for the post-422 fallback search
    let callCount = 0;
    pullsListMock.mockImplementation((params: any) => {
      callCount++;
      if (callCount <= 2) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({
        data: [{ html_url: "https://github.com/owner/repo/pull/3", number: 3, head: { ref: "feature", repo: { full_name: "headOwner/headRepo" } } }],
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
    expect(pullsListMock).toHaveBeenCalledTimes(4); // 2 pre-check + 2 post-422 fallback
  });
});


describe("github token encryption (v2)", () => {
  let oldEnv: string | undefined;

  beforeEach(() => {
    oldEnv = process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
    process.env.GITHUB_TOKEN_ENCRYPTION_KEY = "test-secret-key-123";
  });

  afterEach(() => {
    if (oldEnv !== undefined) {
      process.env.GITHUB_TOKEN_ENCRYPTION_KEY = oldEnv;
    } else {
      delete process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
    }
  });

  test("should decrypt legacy v1 tokens and create random v2 tokens", async () => {
    const { storeGithubTokenInThread, getGithubTokenFromThread } = await import("./github-token");
    const { Client } = await import("@langchain/langgraph-sdk");

    // Generate a legacy token
    const { createCipheriv, scryptSync, randomBytes } = await import("node:crypto");
    const key = scryptSync("test-secret-key-123", "bullhorse-token-salt", 32);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const legacyToken = "my-legacy-token";
    const ciphertext = Buffer.concat([cipher.update(legacyToken, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const encryptedLegacyToken = Buffer.concat([iv, authTag, ciphertext]).toString("base64");

    // Mock Client threads.get and threads.update
    let currentMetadata: any = {
       github_token_encrypted: encryptedLegacyToken
    };

    const mockClient = {
      threads: {
        get: mock(() => Promise.resolve({ metadata: currentMetadata })),
        update: mock(async (threadId: string, data: any) => {
           currentMetadata = { ...currentMetadata, ...data.metadata };
        }),
      }
    };

    // Override the import
    mock.module("@langchain/langgraph-sdk", () => ({
      Client: mock(() => mockClient)
    }));

    // 1. Decrypt legacy token
    const [token, encrypted] = await getGithubTokenFromThread("thread-1");
    expect(token).toBe("my-legacy-token");
    expect(encrypted).toBe(encryptedLegacyToken);

    // 2. Encrypt a new token and store it
    await storeGithubTokenInThread("thread-1", "my-new-token-v2");

    expect(currentMetadata.github_token_encrypted).toStartWith("v2:");

    // 3. Decrypt the new v2 token
    const [newToken, newEncrypted] = await getGithubTokenFromThread("thread-1");
    expect(newToken).toBe("my-new-token-v2");
    expect(newEncrypted).toStartWith("v2:");
  });
});
