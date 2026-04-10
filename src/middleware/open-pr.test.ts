import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { type SandboxService } from "../integrations/sandbox-service";

const originalEnv = { ...process.env };

// Mock logger
mock.module("../utils/logger", () => ({
  createLogger: () => ({
    info: mock(),
    error: mock(),
    debug: mock(),
    warn: mock(),
  }),
}));

// We must mock octokit to satisfy the problem requirement.
// We are verifying that openPrIfNeeded gracefully handles octokit throwing.
mock.module("octokit", () => {
  return {
    Octokit: class {
      rest = {
        repos: {
          get: mock().mockResolvedValue({
            data: {
              default_branch: "main",
              parent: undefined, // simulate non-fork
            },
          }),
        },
        pulls: {
          create: mock().mockImplementation(async () => {
            throw new Error("Octokit PR creation error!");
          }),
          list: mock().mockResolvedValue({ data: [] }),
        },
      };
      // Prevent Octokit constructor itself from throwing if it is called somewhere we don't expect
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
    // We mock only the git utilities from github.ts, BUT NOT createGithubPr.
    // This allows createGithubPr to execute and hit our octokit mock.
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

    // Ensure the message actually contains the error from our mocked Octokit
    expect(result?.error).toContain("Octokit PR creation error!");
  });
});

describe("extractPrParamsFromMessages", () => {
  let extractPrParamsFromMessages: (messages: any[]) => any;

  beforeEach(async () => {
    const module = await import("./open-pr");
    extractPrParamsFromMessages = module.extractPrParamsFromMessages;
  });

  it("returns null for an empty messages array", () => {
    expect(extractPrParamsFromMessages([])).toBeNull();
  });

  it("returns null when no commit_and_open_pr tool result exists", () => {
    const messages = [
      { type: "human", content: "hello" },
      { type: "tool", name: "other_tool", content: "{}" },
    ];
    expect(extractPrParamsFromMessages(messages)).toBeNull();
  });

  it("successfully extracts the payload when content is a stringified JSON", () => {
    const expectedPayload = { title: "Test Title", success: true };
    const messages = [
      {
        type: "tool",
        name: "commit_and_open_pr",
        content: JSON.stringify(expectedPayload),
      },
    ];
    expect(extractPrParamsFromMessages(messages)).toEqual(expectedPayload);
  });

  it("successfully extracts the payload when content is a plain object", () => {
    const expectedPayload = { title: "Test Title", success: true };
    const messages = [
      {
        type: "tool",
        name: "commit_and_open_pr",
        content: expectedPayload,
      },
    ];
    expect(extractPrParamsFromMessages(messages)).toEqual(expectedPayload);
  });

  it("returns the most recent valid tool result when multiple exist", () => {
    const payload1 = { title: "First PR" };
    const payload2 = { title: "Second PR" };
    const messages = [
      {
        type: "tool",
        name: "commit_and_open_pr",
        content: JSON.stringify(payload1),
      },
      { type: "human", content: "some text" },
      {
        type: "tool",
        name: "commit_and_open_pr",
        content: JSON.stringify(payload2),
      },
    ];
    expect(extractPrParamsFromMessages(messages)).toEqual(payload2);
  });

  it("ignores messages with invalid JSON strings, falling back to earlier messages", () => {
    const validPayload = { title: "Valid PR" };
    const messages = [
      {
        type: "tool",
        name: "commit_and_open_pr",
        content: JSON.stringify(validPayload),
      },
      {
        type: "tool",
        name: "commit_and_open_pr",
        content: "invalid { json",
      },
    ];
    expect(extractPrParamsFromMessages(messages)).toEqual(validPayload);
  });

  it("ignores messages with missing or null content", () => {
    const validPayload = { title: "Valid PR" };
    const messages = [
      {
        type: "tool",
        name: "commit_and_open_pr",
        content: JSON.stringify(validPayload),
      },
      {
        type: "tool",
        name: "commit_and_open_pr",
        content: null, // Note: the type signature allows undefined, but usually null is handled by avoiding falsy content
      },
      {
        type: "tool",
        name: "commit_and_open_pr",
      }, // undefined content
    ];
    expect(extractPrParamsFromMessages(messages)).toEqual(validPayload);
  });

  it("ignores messages with non-string/non-object content", () => {
    const validPayload = { title: "Valid PR" };
    const messages = [
      {
        type: "tool",
        name: "commit_and_open_pr",
        content: JSON.stringify(validPayload),
      },
      {
        type: "tool",
        name: "commit_and_open_pr",
        content: 12345, // Number is not string or object
      },
    ];
    expect(extractPrParamsFromMessages(messages)).toEqual(validPayload);
  });

  it("returns null if the only commit_and_open_pr content is not an object after parsing", () => {
    const messages = [
      {
        type: "tool",
        name: "commit_and_open_pr",
        content: JSON.stringify("just a string"),
      },
    ];
    expect(extractPrParamsFromMessages(messages)).toBeNull();
  });
});
