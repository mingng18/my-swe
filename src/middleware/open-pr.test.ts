import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { type SandboxService } from "../integrations/sandbox-service";


const originalEnv = { ...process.env };

// Mock logger
const mockInfo = mock();
const mockError = mock();
const mockDebug = mock();
const mockWarn = mock();

mock.module("../utils/logger", () => ({
  createLogger: () => ({
    info: mockInfo,
    error: mockError,
    debug: mockDebug,
    warn: mockWarn,
  }),
}));

mock.module("octokit", () => {
  return {
    Octokit: class {
      rest = {
        repos: {
          get: mock().mockResolvedValue({
            data: { default_branch: "main", parent: undefined }
          })
        },
        pulls: {
          create: mock().mockImplementation(async () => {
            throw new Error("Octokit PR creation error!");
          }),
          list: mock().mockResolvedValue({ data: [] }),
        },
      };
      constructor() {}
    },
  };
});

describe("openPrIfNeeded", () => {
  beforeEach(() => {
    process.env = { ...originalEnv, GITHUB_TOKEN: "fake-token" };
  });

  afterEach(() => {
    process.env = originalEnv;
    mock.restore();
  });

  it("handles PR creation failure gracefully when gitPush succeeds and octokit throws", async () => {
    const githubModule = await import("../utils/github");

    mock.module("../utils/github", () => {
      return {
        ...githubModule,
        getGithubTokenFromThread: mock().mockResolvedValue(["fake-token"]),
        gitHasUncommittedChanges: mock().mockResolvedValue(true),
        gitFetchOrigin: mock().mockResolvedValue("fetched"),
        gitHasUnpushedCommits: mock().mockResolvedValue(true),
        gitCurrentBranch: mock().mockResolvedValue("test-branch"),
        gitCheckoutBranch: mock().mockResolvedValue(true),
        gitConfigUser: mock().mockResolvedValue(undefined),
        gitAddAll: mock().mockResolvedValue("added"),
        gitCommit: mock().mockResolvedValue("committed"),
        findExistingPr: mock().mockResolvedValue(null),
        gitPush: mock().mockResolvedValue("pushed"),
      };
    });

    const { openPrIfNeeded } = await import("./open-pr");

    const mockSandboxBackend = {
      execute: mock().mockResolvedValue({ exitCode: 0, output: "" }),
    } as unknown as SandboxService;

    const mockState = {
      messages: [
        {
          type: "tool",
          name: "commit_and_open_pr",
          content: JSON.stringify({
            title: "Test PR",
            body: "Test Body",
            commit_message: "Test Commit",
          }),
        },
      ],
    };

    const mockConfig = {
      configurable: {
        thread_id: "test-thread",
        repo: {
          owner: "test-owner",
          name: "test-repo",
        },
      },
      metadata: {
        branch_name: "test-branch",
      },
    };

    const result = await openPrIfNeeded(
      mockState,
      mockConfig,
      mockSandboxBackend,
      "test-repo",
    );

    expect(result).toEqual({
      error: expect.stringContaining("PR creation failed:"),
      pushSucceeded: true,
      prCreated: false,
    });

    expect(result?.error).toContain("Octokit PR creation error!");
  });
});

describe("withOpenPrAfterAgent", () => {
  it("calls underlying agent and passes the state", async () => {
    // Dynamically import to ensure mock.module calls have taken effect
    const { withOpenPrAfterAgent } = await import("./open-pr");
    const { createLogger } = await import("../utils/logger");

    // Grab the mocked logger instance
    mockInfo.mockClear();

    const mockAgent = mock().mockResolvedValue({ stateUpdated: true });

    const mockConfig = {
      sandboxBackend: {} as SandboxService,
      repoDir: "test-repo"
    };

    const wrappedAgent = withOpenPrAfterAgent(mockAgent, mockConfig);

    const mockState = {
      messages: [],
      configurable: {
        thread_id: "test-thread",
        repo: { owner: "test-owner", name: "test-repo" }
      },
      metadata: { branch_name: "test-branch" }
    };

    const result = await wrappedAgent(mockState as any);

    // Verify the agent result is returned
    expect(result).toEqual({ stateUpdated: true });

    // Verify the underlying agent was called with the correct state
    expect(mockAgent).toHaveBeenCalledWith(mockState);

    // Verify openPrIfNeeded logic was triggered by checking logger output
    expect(mockInfo).toHaveBeenCalledWith("After-agent middleware started");
  });
});
