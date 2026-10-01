import {
  describe,
  it,
  expect,
  mock,
  beforeEach,
  afterEach,
  spyOn,
} from "bun:test";

const mockRunCodeagentTurn = mock(
  async (input: string) => `Mocked reply for: ${input}`,
);

export const mockGithubState = {
  extractPrContextReturn: [
    { owner: "test", name: "repo" },
    123,
    "main",
    "testuser",
    "https://github.com/test/repo/pull/123",
    1,
    "node-1",
  ] as any,
  extractPrContextThrow: false,
  fetchPrCommentsReturn: [{ body: "test comment" }] as any,
  getGithubAppInstallationTokenReturn: "mock-token" as any,
  getGithubTokenReturn: "mock-gh-token" as any,
  postGithubCommentThrow: false,
};

mock.module("../../server", () => ({
  runCodeagentTurn: mockRunCodeagentTurn,
}));

mock.module("../../utils/github", () => ({
  extractPrContext: mock(async () => {
    if (mockGithubState.extractPrContextThrow)
      throw new Error("Mock extract error");
    return mockGithubState.extractPrContextReturn;
  }),
  fetchPrCommentsSinceLastTag: mock(
    async () => mockGithubState.fetchPrCommentsReturn,
  ),
  buildPrPrompt: mock(() => "mock pr prompt"),
  reactToGithubComment: mock(async () => true),
  getThreadIdFromBranch: mock(async () => "mock-thread-id"),
  getGithubAppInstallationToken: mock(
    async () => mockGithubState.getGithubAppInstallationTokenReturn,
  ),
  storeGithubTokenInThread: mock(async () => {}),
  postGithubComment: mock(async () => {
    if (mockGithubState.postGithubCommentThrow)
      throw new Error("Mock post error");
    return true;
  }),
  getGithubToken: mock(() => mockGithubState.getGithubTokenReturn),
}));

mock.module("../../utils/identity", () => ({
  getEmailForIdentity: mock(() => "test@example.com"),
}));

// Import AFTER setting up mocks
const { handleGithubWebhook } = await import("../github");

describe("handleGithubWebhook", () => {
  beforeEach(() => {
    mockRunCodeagentTurn.mockClear();
    mockGithubState.extractPrContextReturn = [
      { owner: "test", name: "repo" },
      123,
      "main",
      "testuser",
      "https://github.com/test/repo/pull/123",
      1,
      "node-1",
    ];
    mockGithubState.extractPrContextThrow = false;
    mockGithubState.fetchPrCommentsReturn = [{ body: "test comment" }];
    mockGithubState.getGithubAppInstallationTokenReturn = "mock-token";
    mockGithubState.getGithubTokenReturn = "mock-gh-token";
    mockGithubState.postGithubCommentThrow = false;
  });

  it("handles ping event without errors", () => {
    expect(() => handleGithubWebhook({}, "ping")).not.toThrow();
  });

  it("handles unknown events gracefully", () => {
    expect(() => handleGithubWebhook({}, "unknown_event")).not.toThrow();
  });

  describe("push events", () => {
    it("handles background processing errors gracefully in push event", async () => {
      const { logger } = await import("../../utils/logger");
      const errorSpy = spyOn(logger, "error");

      mockRunCodeagentTurn.mockImplementationOnce(async () => {
        throw new Error("Mock runCodeagentTurn error for push");
      });

      handleGithubWebhook(
        {
          ref: "refs/heads/main",
          repository: { full_name: "test/repo", default_branch: "main" },
          commits: [{}],
        },
        "push",
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockRunCodeagentTurn).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        "[github] Error running agent on push event",
      );
      errorSpy.mockRestore();
    });

    it("handles push event to default branch", async () => {
      handleGithubWebhook(
        {
          ref: "refs/heads/main",
          repository: { full_name: "test/repo", default_branch: "main" },
          commits: [{}],
        },
        "push",
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockRunCodeagentTurn).toHaveBeenCalled();
    });

    it("ignores push event to non-default branch", async () => {
      handleGithubWebhook(
        {
          ref: "refs/heads/feature",
          repository: { full_name: "test/repo", default_branch: "main" },
          commits: [{}],
        },
        "push",
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockRunCodeagentTurn).not.toHaveBeenCalled();
    });
  });

  describe("pull_request events", () => {
    it("handles pull_request event successfully", async () => {
      handleGithubWebhook(
        {
          action: "opened",
          pull_request: { number: 123 },
          repository: { full_name: "test/repo" },
        },
        "pull_request",
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockRunCodeagentTurn).toHaveBeenCalled();
    });

    it("ignores issue_comment if not on a pull request", async () => {
      handleGithubWebhook(
        {
          action: "created",
          issue: { number: 123 }, // No pull_request field
        },
        "issue_comment",
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockRunCodeagentTurn).not.toHaveBeenCalled();
    });

    it("returns early if no prNumber is extracted", async () => {
      mockGithubState.extractPrContextReturn = [
        { owner: "test", name: "repo" },
        null,
        "main",
        "testuser",
        "https://github.com/test/repo/pull/123",
        1,
        "node-1",
      ];

      handleGithubWebhook(
        {
          action: "opened",
          pull_request: { number: 123 },
          repository: { full_name: "test/repo" },
        },
        "pull_request",
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockRunCodeagentTurn).not.toHaveBeenCalled();
    });

    it("returns early if no token is available", async () => {
      mockGithubState.getGithubAppInstallationTokenReturn = "";
      process.env.GITHUB_TOKEN = ""; // Ensure env token is also empty

      handleGithubWebhook(
        {
          action: "opened",
          pull_request: { number: 123 },
          repository: { full_name: "test/repo" },
        },
        "pull_request",
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockRunCodeagentTurn).not.toHaveBeenCalled();
    });

    it("returns early if no comments are available", async () => {
      mockGithubState.fetchPrCommentsReturn = [];

      handleGithubWebhook(
        {
          action: "opened",
          pull_request: { number: 123 },
          repository: { full_name: "test/repo" },
        },
        "pull_request",
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockRunCodeagentTurn).not.toHaveBeenCalled();
    });

    it("handles background processing errors gracefully when extracting PR context fails", async () => {
      const { logger } = await import("../../utils/logger");
      const errorSpy = spyOn(logger, "error");
      mockGithubState.extractPrContextThrow = true;

      try {
        expect(() => {
          handleGithubWebhook(
            {
              action: "opened",
              pull_request: { number: 123 },
              repository: { full_name: "test/repo" },
            },
            "pull_request",
          );
        }).not.toThrow();

        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(mockRunCodeagentTurn).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Error) }),
          "[github] Background PR processing failed",
        );
      } finally {
        errorSpy.mockRestore();
      }
    });

    it("handles background processing errors gracefully in PR agent turn", async () => {
      const { logger } = await import("../../utils/logger");
      const errorSpy = spyOn(logger, "error");

      mockRunCodeagentTurn.mockImplementationOnce(async () => {
        throw new Error("Mock runCodeagentTurn error for PR");
      });

      handleGithubWebhook(
        {
          action: "opened",
          pull_request: { number: 123 },
          repository: { full_name: "test/repo" },
        },
        "pull_request",
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockRunCodeagentTurn).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        "[github] Background PR processing failed",
      );
      errorSpy.mockRestore();
    });
  });

  describe("issues events", () => {
    it("handles issues opened event when bot is mentioned", async () => {
      handleGithubWebhook(
        {
          action: "opened",
          issue: {
            number: 42,
            title: "Bug report",
            body: "Something is broken @openswe",
          },
          repository: {
            full_name: "test/repo",
            name: "repo",
            owner: { login: "test" },
          },
        },
        "issues",
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockRunCodeagentTurn).toHaveBeenCalled();
    });

    it("ignores issues that are not opened", async () => {
      expect(() =>
        handleGithubWebhook(
          {
            action: "closed",
            issue: { number: 42, title: "Bug report" },
            repository: { full_name: "test/repo" },
          },
          "issues",
        ),
      ).not.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockRunCodeagentTurn).not.toHaveBeenCalled();
    });

    it("ignores issues opened event if bot is not mentioned", async () => {
      handleGithubWebhook(
        {
          action: "opened",
          issue: {
            number: 42,
            title: "Bug report",
            body: "Just a normal issue description",
          },
          repository: {
            full_name: "test/repo",
            name: "repo",
            owner: { login: "test" },
          },
        },
        "issues",
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockRunCodeagentTurn).not.toHaveBeenCalled();
    });

    it("handles missing token gracefully when trying to post reply", async () => {
      mockGithubState.getGithubAppInstallationTokenReturn = "";
      mockGithubState.getGithubTokenReturn = "";

      handleGithubWebhook(
        {
          action: "opened",
          issue: {
            number: 42,
            title: "Bug report",
            body: "Something is broken @openswe",
          },
          repository: {
            full_name: "test/repo",
            name: "repo",
            owner: { login: "test" },
          },
        },
        "issues",
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockRunCodeagentTurn).toHaveBeenCalled(); // Should still run agent turn
      // But will log a warning about missing token
    });

    it("handles background processing errors gracefully when posting comment fails", async () => {
      mockGithubState.postGithubCommentThrow = true;

      expect(() => {
        handleGithubWebhook(
          {
            action: "opened",
            issue: {
              number: 42,
              title: "Bug report",
              body: "Something is broken @openswe",
            },
            repository: {
              full_name: "test/repo",
              name: "repo",
              owner: { login: "test" },
            },
          },
          "issues",
        );
      }).not.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockRunCodeagentTurn).toHaveBeenCalled();
    });

    it("handles background processing errors gracefully in issue agent turn", async () => {
      const { logger } = await import("../../utils/logger");
      const errorSpy = spyOn(logger, "error");

      mockRunCodeagentTurn.mockImplementationOnce(async () => {
        throw new Error("Mock runCodeagentTurn error for issue");
      });

      handleGithubWebhook(
        {
          action: "opened",
          issue: {
            number: 42,
            title: "Bug report",
            body: "Something is broken @openswe",
          },
          repository: {
            full_name: "test/repo",
            name: "repo",
            owner: { login: "test" },
          },
        },
        "issues",
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockRunCodeagentTurn).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        "[github] Error processing issue event",
      );
      errorSpy.mockRestore();
    });
  });
});
