import { describe, it, expect, mock } from "bun:test";

const mockRunCodeagentTurn = mock(async (input: string) => `Mocked reply for: ${input}`);

mock.module("../../server", () => ({
  runCodeagentTurn: mockRunCodeagentTurn,
}));

mock.module("../../utils/github", () => ({
  extractPrContext: mock(async () => [
    { owner: "test", name: "repo" }, 123, "main", "testuser", "https://github.com/test/repo/pull/123", 1, "node-1",
  ]),
  fetchPrCommentsSinceLastTag: mock(async () => [{ body: "test comment" }]),
  buildPrPrompt: mock(() => "mock pr prompt"),
  reactToGithubComment: mock(async () => true),
  getThreadIdFromBranch: mock(async () => "mock-thread-id"),
  getGithubAppInstallationToken: mock(async () => "mock-token"),
  storeGithubTokenInThread: mock(async () => {}),
  postGithubComment: mock(async () => true),
  getGithubToken: mock(() => "mock-gh-token"),
}));

mock.module("../../utils/identity", () => ({
  getEmailForIdentity: mock(() => "test@example.com"),
}));

const { handleGithubWebhook } = await import("../github");

describe("handleGithubWebhook", () => {
  it("handles ping event without errors", () => {
    expect(() => handleGithubWebhook({}, "ping")).not.toThrow();
  });

  it("handles unknown events gracefully", () => {
    expect(() => handleGithubWebhook({}, "unknown_event")).not.toThrow();
  });

  it("handles push event", async () => {
    handleGithubWebhook(
      {
        ref: "refs/heads/main",
        repository: { full_name: "test/repo", default_branch: "main" },
        commits: [{}],
      },
      "push",
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    const { runCodeagentTurn } = await import("../../server");
    expect(runCodeagentTurn).toHaveBeenCalled();
  });

  it("handles pull_request event", async () => {
    handleGithubWebhook(
      {
        action: "opened",
        pull_request: { number: 1 },
        repository: { full_name: "test/repo" },
      },
      "pull_request",
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    const { runCodeagentTurn } = await import("../../server");
    expect(runCodeagentTurn).toHaveBeenCalled();
  });

  it("handles issues opened event", async () => {
    handleGithubWebhook(
      {
        action: "opened",
        issue: {
          number: 42,
          title: "Bug report",
          body: "Something is broken",
        },
        repository: {
          full_name: "test/repo",
          name: "repo",
          owner: { login: "test" },
        },
      },
      "issues",
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    const { runCodeagentTurn } = await import("../../server");
    expect(runCodeagentTurn).toHaveBeenCalled();
  });

  it("ignores issues that are not opened", () => {
    expect(() =>
      handleGithubWebhook(
        {
          action: "closed",
          issue: { number: 42, title: "Bug report" },
          repository: { full_name: "test/repo" },
        },
        "issues",
      )
    ).not.toThrow();
  });
});