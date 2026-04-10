import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { type SandboxService } from "../integrations/sandbox-service";


const originalEnv = { ...process.env };

// Mock logger
const globalLoggerMock = {
  info: mock(),
  error: mock(),
  debug: mock(),
  warn: mock(),
};

// Mock logger
mock.module("../utils/logger", () => ({
  createLogger: () => globalLoggerMock,
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

// Since the issue specifies the function signature as `export function withOpenPrAfterAgent<T extends AgentState>(agent: Agent<T>): Agent<T>`,
// we will test it with a single argument by mocking the underlying `openPrIfNeeded` function to verify it's called.
describe("withOpenPrAfterAgent", () => {
  it("correctly intercepts and processes the output of a mock agent", async () => {
    const { withOpenPrAfterAgent } = await import("./open-pr");

    const mockState = {
      messages: [
        {
          type: "tool",
          name: "commit_and_open_pr",
          content: JSON.stringify({ title: "Test" })
        }
      ],
      configurable: { thread_id: "test", repo: { owner: "test", name: "test" } },
      metadata: {}
    };

    const mockResult = { done: true };
    const mockAgent = mock().mockResolvedValue(mockResult);

    // We can verify that openPrIfNeeded was executed by observing the logger.
    // The logger mock is already setup globally in this file.
    const { createLogger } = await import("../utils/logger");
    const loggerMock = createLogger();

    // Call with exactly one argument as specified by the issue
    const wrappedFn = withOpenPrAfterAgent(mockAgent);
    const result = await wrappedFn(mockState as any);

    // Verify the agent was called
    expect(mockAgent).toHaveBeenCalledTimes(1);
    expect(mockAgent).toHaveBeenCalledWith(mockState);

    // Verify the result is passed through correctly
    expect(result).toBe(mockResult);

    // Verify openPrIfNeeded was triggered and executed its early logic
    // Since we don't pass sandboxBackend (to keep to the 1-arg signature), it should exit early
    // and log "No sandbox backend or repo name, skipping PR creation"
    expect(loggerMock.info).toHaveBeenCalledWith("No sandbox backend or repo name, skipping PR creation");
  });
});
