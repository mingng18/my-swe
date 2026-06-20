import { describe, it, expect, mock, beforeEach, spyOn, afterEach } from "bun:test";
import { ThreadManager, THREAD_TTL_MS, threadManager as exportedThreadManager, threadRepoMap as exportedThreadRepoMap } from "../thread-manager";
import * as daytonaPool from "../../integrations/daytona-pool";
import * as sandboxState from "../../utils/sandboxState";
import { toolInvocationTracker } from "../../middleware/tool-invocation-limits";
import * as threadMetadataStore from "../../utils/thread-metadata-store";
import type { DeepAgent } from "deepagents";
import type { SandboxService } from "../../integrations/sandbox-service";
import type { SandboxProfile } from "../../integrations/daytona-pool";
import type { RepoContext, ThreadSandboxEntry } from "../thread-manager";

describe("ThreadManager", () => {
  describe("Exports", () => {
    it("should export a configured singleton threadManager", () => {
      expect(exportedThreadManager).toBeInstanceOf(ThreadManager);
    });

    it("should export threadRepoMap pointing to threadManager's map", () => {
      expect(exportedThreadRepoMap).toBe(exportedThreadManager.threadRepoMap);
    });
  });
  let threadManager: ThreadManager;

  beforeEach(() => {
    threadManager = new ThreadManager(100); // 100ms TTL for testing
  });

  afterEach(() => {
    // Clear maps to trigger dispose logic while mocks are still active
    threadManager.clearAll();
    // Then restore mocks
    mock.restore();
  });

  describe("Agent Management", () => {
    it("should store and retrieve an agent", () => {
      const mockAgent = {} as DeepAgent;
      threadManager.setAgent("thread-1", mockAgent);

      expect(threadManager.getAgent("thread-1")).toBe(mockAgent);
    });

    it("should return undefined for non-existent agent", () => {
      expect(threadManager.getAgent("non-existent")).toBeUndefined();
    });
  });

  describe("Sandbox Management", () => {
    it("should store and retrieve a sandbox entry", () => {
      const mockBackendCleanup = mock(() => Promise.resolve());
      const mockSandboxEntry = {
        backend: { cleanup: mockBackendCleanup } as unknown as SandboxService,
        profile: {} as SandboxProfile,
        repo: { owner: "test", name: "repo", workspaceDir: "/work" } as RepoContext
      };

      threadManager.setSandbox("thread-1", mockSandboxEntry);

      expect(threadManager.getSandbox("thread-1")).toBe(mockSandboxEntry);
    });
  });

  describe("Repo Management", () => {
    it("should store and retrieve a repo context", () => {
      const mockRepo: RepoContext = { owner: "test", name: "repo", workspaceDir: "/work" };

      threadManager.setRepo("thread-1", mockRepo);

      expect(threadManager.getRepo("thread-1")).toBe(mockRepo);
    });
  });

  describe("Clear Operations", () => {
    it("should clear all maps", () => {
      const mockBackendCleanup = mock(() => Promise.resolve());
      spyOn(daytonaPool, "releaseRepoSandbox").mockResolvedValue();
      spyOn(sandboxState, "clearSandboxBackend");
      spyOn(toolInvocationTracker, "clearThread");
      spyOn(threadMetadataStore, "removePersistedThreadRepo").mockResolvedValue();

      threadManager.setAgent("thread-1", {} as DeepAgent);
      threadManager.setSandbox("thread-2", {
        backend: { id: "test-id", cleanup: mockBackendCleanup } as unknown as SandboxService,
        profile: {} as SandboxProfile,
        repo: { owner: "test", name: "repo" } as RepoContext
      });
      threadManager.setRepo("thread-3", {} as RepoContext);

      threadManager.clearAll();

      expect(threadManager.getAgent("thread-1")).toBeUndefined();
      expect(threadManager.getSandbox("thread-2")).toBeUndefined();
      expect(threadManager.getRepo("thread-3")).toBeUndefined();
    });
  });

  describe("TTL and Eviction", () => {
    it("should evict agents after TTL", async () => {
      threadManager.setAgent("thread-1", {} as DeepAgent);

      await new Promise(resolve => setTimeout(resolve, 150));
      threadManager.purgeStale();

      expect(threadManager.getAgent("thread-1")).toBeUndefined();
    });

    it("should call disposal functions on sandbox eviction", async () => {
      const releaseRepoSandboxSpy = spyOn(daytonaPool, "releaseRepoSandbox").mockResolvedValue();
      const clearSandboxBackendSpy = spyOn(sandboxState, "clearSandboxBackend");
      const clearThreadSpy = spyOn(toolInvocationTracker, "clearThread");

      const mockBackendCleanup = mock(() => Promise.resolve());
      const mockSandboxEntry = {
        backend: { id: "sandbox-1", cleanup: mockBackendCleanup } as unknown as SandboxService,
        profile: {} as SandboxProfile,
        repo: { owner: "test", name: "repo", workspaceDir: "/work" } as RepoContext
      };

      threadManager.setSandbox("thread-1", mockSandboxEntry);

      // Force eviction by waiting and purging
      await new Promise(resolve => setTimeout(resolve, 150));
      threadManager.purgeStale();

      // Wait for async disposal to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(releaseRepoSandboxSpy).toHaveBeenCalled();
      expect(mockBackendCleanup).toHaveBeenCalled();
      expect(clearSandboxBackendSpy).toHaveBeenCalledWith("thread-1");
      expect(clearThreadSpy).toHaveBeenCalledWith("thread-1");
    });

    it("should handle disposal failures gracefully", async () => {
      // Don't instantiate Error outside of throw or reject if it causes Bun to fail tests
      // just pass a rejected promise with an object
      spyOn(daytonaPool, "releaseRepoSandbox").mockImplementation(() => Promise.reject({ name: "MockError", message: "Failed release" }));
      const mockBackendCleanup = mock(() => Promise.reject({ name: "MockError", message: "Failed cleanup" }));
      spyOn(sandboxState, "clearSandboxBackend");
      spyOn(toolInvocationTracker, "clearThread");

      const mockSandboxEntry = {
        backend: { id: "sandbox-1", cleanup: mockBackendCleanup } as unknown as SandboxService,
        profile: {} as SandboxProfile,
        repo: { owner: "test", name: "repo", workspaceDir: "/work" } as RepoContext
      };

      threadManager.setSandbox("thread-error", mockSandboxEntry);

      // Force eviction by waiting and purging
      await new Promise(resolve => setTimeout(resolve, 150));
      threadManager.purgeStale();

      // Wait for async disposal to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should still clean up the other states even if sandbox release fails
      expect(sandboxState.clearSandboxBackend).toHaveBeenCalledWith("thread-error");
      expect(toolInvocationTracker.clearThread).toHaveBeenCalledWith("thread-error");
    });

    it("should handle disposal failures gracefully during repo eviction", async () => {
      const err = new Error("Repo removal failed");
      const removePersistedThreadRepoSpy = spyOn(threadMetadataStore, "removePersistedThreadRepo").mockImplementation(() => Promise.reject(err));

      threadManager.setRepo("thread-error-repo", {} as RepoContext);

      // Force eviction by waiting and purging
      await new Promise(resolve => setTimeout(resolve, 150));
      threadManager.purgeStale();

      expect(removePersistedThreadRepoSpy).toHaveBeenCalledWith("thread-error-repo");
    });

    it("should call disposal functions on repo eviction", async () => {
      const removePersistedThreadRepoSpy = spyOn(threadMetadataStore, "removePersistedThreadRepo").mockResolvedValue();

      threadManager.setRepo("thread-1", {} as RepoContext);

      // Force eviction by waiting and purging
      await new Promise(resolve => setTimeout(resolve, 150));
      threadManager.purgeStale();

      expect(removePersistedThreadRepoSpy).toHaveBeenCalledWith("thread-1");
    });
  });

  describe("Per-thread checkpointer (#505 retro: bounded + history-preserving)", () => {
    it("getCheckpointer is create-on-demand and stable per thread", () => {
      const cp1 = threadManager.getCheckpointer("thread-cp");
      const cp2 = threadManager.getCheckpointer("thread-cp");
      expect(cp1).toBe(cp2); // same instance across calls
    });

    it("different threads get different checkpointers (state isolated by thread_id)", () => {
      const cpA = threadManager.getCheckpointer("thread-A");
      const cpB = threadManager.getCheckpointer("thread-B");
      expect(cpA).not.toBe(cpB);
    });

    it("clearAgent (e.g. /model rebuild) KEEPS the checkpointer so history survives", () => {
      const cp = threadManager.getCheckpointer("thread-model");
      threadManager.setAgent("thread-model", {} as DeepAgent);

      threadManager.clearAgent("thread-model");

      // Agent is gone — next turn rebuilds it. But the checkpointer MUST stay
      // so the rebuilt agent reuses the same conversation history.
      expect(threadManager.getAgent("thread-model")).toBeUndefined();
      expect(threadManager.getCheckpointer("thread-model")).toBe(cp);
    });

    it("purgeStale drops the checkpointer on TTL eviction (bounded)", async () => {
      const threadManager2 = new ThreadManager(100); // 100ms TTL
      const cp = threadManager2.getCheckpointer("thread-evict");

      await new Promise(resolve => setTimeout(resolve, 150));
      threadManager2.purgeStale();

      // Evicted -> a new getCheckpointer call returns a fresh instance.
      expect(threadManager2.getCheckpointer("thread-evict")).not.toBe(cp);
    });

    it("clearAll drops all checkpointers", () => {
      const cp = threadManager.getCheckpointer("thread-clearall");
      threadManager.clearAll();
      expect(threadManager.getCheckpointer("thread-clearall")).not.toBe(cp);
    });
  });
});
