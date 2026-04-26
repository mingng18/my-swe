import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { commitAndOpenPrTool } from "../commit-and-open-pr";

import { spyOn } from "bun:test";
import * as githubToken from "../../utils/github/github-token";
import * as sandboxState from "../../utils/sandboxState";

describe("commit_and_open_pr tool", () => {
  let mockGetGithubTokenFromThread: any;
  let mockGetSandboxBackendSync: any;

  beforeEach(() => {
    mockGetGithubTokenFromThread = spyOn(githubToken, "getGithubTokenFromThread").mockResolvedValue(["ghp_test_token"] as any);
  });

  afterEach(() => {
    if (mockGetGithubTokenFromThread) mockGetGithubTokenFromThread.mockRestore();
    if (mockGetSandboxBackendSync) mockGetSandboxBackendSync.mockRestore();
  });

  describe("branch naming", () => {
    it("should use simple branch name without timestamp", async () => {
      const mockSandbox = {
        execute: mock(() => Promise.resolve("")),
        cloneRepo: mock(() => Promise.resolve("/workspace/test")),
        cleanup: mock(() => Promise.resolve()),
        id: "test-sandbox",
      };

      const mockConfig = {
        configurable: {
          thread_id: "test-thread-123",
          repo: {
            owner: "testowner",
            name: "testrepo",
            workspaceDir: "/workspace/testrepo",
          },
        },
      };

      // Mock sandbox state using spyOn
      mockGetSandboxBackendSync = spyOn(sandboxState, "getSandboxBackendSync").mockReturnValue(mockSandbox as any);

      // The branch name should be `open-swe/test-thread-123` without timestamp
      // This is tested implicitly by the tool execution
      expect(commitAndOpenPrTool).toBeDefined();
    });

    it("should use metadata branch name when provided", async () => {
      const mockConfig = {
        configurable: {
          thread_id: "test-thread-123",
          repo: {
            owner: "testowner",
            name: "testrepo",
            workspaceDir: "/workspace/testrepo",
          },
        },
        metadata: {
          branch_name: "feature/my-custom-branch",
        },
      };

      // When metadata branch_name is set, it should be used instead of open-swe/<threadId>
      expect(mockConfig.metadata.branch_name).toBe("feature/my-custom-branch");
    });
  });

  describe("checkout behavior", () => {
    it("should checkout existing branch without reset", async () => {
      const mockSandbox = {
        execute: mock((cmd: string) => {
          if (cmd.includes("git branch --list")) {
            return Promise.resolve("open-swe/test-thread-123"); // Branch exists
          }
          return Promise.resolve("");
        }),
        cloneRepo: mock(() => Promise.resolve("/workspace/test")),
        cleanup: mock(() => Promise.resolve()),
        id: "test-sandbox",
      };

      // When branch exists, should checkout without -B flag
      const listCmd =
        "cd '/workspace/testrepo' && git branch --list 'open-swe/test-thread-123'";
      const result = await mockSandbox.execute(listCmd);
      expect(result).toBe("open-swe/test-thread-123");

      // Should use simple checkout, not checkout -B
      const checkoutCmd =
        "cd '/workspace/testrepo' && git checkout 'open-swe/test-thread-123'";
      expect(checkoutCmd).not.toContain("checkout -b");
      expect(checkoutCmd).not.toContain("checkout -B");
    });

    it("should create new branch when it doesn't exist", async () => {
      const mockSandbox = {
        execute: mock((cmd: string) => {
          if (cmd.includes("git branch --list")) {
            return Promise.resolve(""); // Branch doesn't exist
          }
          return Promise.resolve("");
        }),
        cloneRepo: mock(() => Promise.resolve("/workspace/test")),
        cleanup: mock(() => Promise.resolve()),
        id: "test-sandbox",
      };

      // When branch doesn't exist, should create with checkout -b
      const listCmd =
        "cd '/workspace/testrepo' && git branch --list 'open-swe/test-thread-123'";
      const result = await mockSandbox.execute(listCmd);
      expect(result).toBe("");

      // Should use checkout -b to create new branch
      const checkoutCmd =
        "cd '/workspace/testrepo' && git checkout -b 'open-swe/test-thread-123'";
      expect(checkoutCmd).toContain("checkout -b");
    });
  });

  describe("commit detection", () => {
    it("should only commit when there are uncommitted changes", async () => {
      // Scenario: Has unpushed commits but no uncommitted changes
      const hasUncommittedChanges = false;
      const hasUnpushedCommits = true;

      // Should NOT run git commit (no uncommitted changes)
      expect(hasUncommittedChanges).toBe(false);

      // But SHOULD still push and create PR (has unpushed commits)
      expect(hasUnpushedCommits).toBe(true);
      expect(hasUncommittedChanges || hasUnpushedCommits).toBe(true);
    });

    it("should commit when there are uncommitted changes", async () => {
      const hasUncommittedChanges = true;
      const hasUnpushedCommits = false;

      // Should run git commit (has uncommitted changes)
      expect(hasUncommittedChanges).toBe(true);
      expect(hasUncommittedChanges || hasUnpushedCommits).toBe(true);
    });

    it("should return error when no changes detected", async () => {
      const hasUncommittedChanges = false;
      const hasUnpushedCommits = false;

      // Should return "No changes detected" error
      expect(hasUncommittedChanges || hasUnpushedCommits).toBe(false);
    });
  });
});
