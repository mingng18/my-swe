import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";

// Must mock module before importing to avoid initialization issues
mock.module("../../utils/thread-metadata-store", () => ({
  loadPersistedThreadRepos: mock(async () => {
    const map = new Map();
    map.set("thread1", {
      owner: "test",
      name: "repo",
      workspaceDir: "/tmp/dir",
      lastAccessed: Date.now(),
    });
    return map;
  }),
  persistThreadRepo: mock(() => Promise.resolve()),
  removePersistedThreadRepo: mock(() => Promise.resolve()),
}));

mock.module("@daytonaio/sdk", () => ({}));
mock.module("../../sandbox/daytona-snapshot-integration", () => ({}));
mock.module("deepagents", () => ({}));
mock.module("@alibaba-group/opensandbox", () => ({}));
mock.module("@langchain/langgraph", () => ({}));
mock.module("langchain", () => ({}));
mock.module("zod", () => ({}));
mock.module("octokit", () => ({}));
mock.module("../../sandbox", () => ({}));



import {
  initDeepAgentsAtStartup,
  resetDeepAgentsStateForTesting,
  getThreadRepoMapForTesting,
  cleanupDeepAgents,
} from "../deepagents";
import * as threadMetadataStore from "../../utils/thread-metadata-store";
import * as sandbox from "../../sandbox";
import { logger } from "../../utils/logger";

describe("initDeepAgentsAtStartup", () => {
  beforeEach(() => {
    resetDeepAgentsStateForTesting();
    mock.restore();
    (threadMetadataStore.loadPersistedThreadRepos as any).mockClear();
  });

  test("should load persisted repos and initialize snapshot store on first call", async () => {
    await initDeepAgentsAtStartup();

    expect(threadMetadataStore.loadPersistedThreadRepos).toHaveBeenCalled();
    const repoMap = getThreadRepoMapForTesting();
    expect(repoMap.size).toBe(1);
    const thread1Repo = repoMap.get("thread1");
    expect(thread1Repo).toBeDefined();
    expect(thread1Repo?.owner).toBe("test");
    expect(thread1Repo?.name).toBe("repo");
    expect(thread1Repo?.workspaceDir).toBe("/tmp/dir");
    expect(thread1Repo?.lastAccessed).toBeDefined();
    expect(typeof thread1Repo?.lastAccessed).toBe("number");
  });

  test("should be idempotent and not load persisted repos twice", async () => {
    await initDeepAgentsAtStartup();
    expect(threadMetadataStore.loadPersistedThreadRepos).toHaveBeenCalledTimes(
      1,
    );

    // Call it again
    await initDeepAgentsAtStartup();
    // It should not be called again
    expect(threadMetadataStore.loadPersistedThreadRepos).toHaveBeenCalledTimes(
      1,
    );
  });

});

describe("deepagents cleanup", () => {
  test("cleanupDeepAgents executes successfully when maps are empty", async () => {
    // Wait for the cleanup function to complete.
    // If it throws or returns a rejected promise, the test will automatically fail.
    await cleanupDeepAgents();
  });
});


describe("DeepAgentWrapper", () => {
  let wrapper: any;
  let threadManager: any;

  beforeEach(async () => {
    const deepagents = await import("../deepagents");
    const tm = await import("../thread-manager");
    threadManager = tm.threadManager;
    wrapper = new deepagents.DeepAgentWrapper();
    mock.restore();
    threadManager.clearAll();
  });

  describe("getState", () => {
    test("returns null if no agent exists for the thread", async () => {
      const state = await wrapper.getState("thread-no-agent");
      expect(state).toBeNull();
    });

    test("returns agent state and calls markAccessed if agent exists", async () => {
      const schedulerMod = await import("../../utils/thread-cleanup-scheduler");
      const mockMarkAccessed = mock(() => {});
      const spy = spyOn(schedulerMod, "getThreadCleanupScheduler").mockImplementation(() => ({
        markAccessed: mockMarkAccessed,
      }) as any);

      const mockAgentState = { some: "state" };
      const mockAgent = {
        getState: mock(() => Promise.resolve(mockAgentState)),
      } as any;

      threadManager.setAgent("thread-with-agent", mockAgent);

      const state = await wrapper.getState("thread-with-agent");

      expect(state).toEqual(mockAgentState);
      expect(mockAgent.getState).toHaveBeenCalledWith({ configurable: { thread_id: "thread-with-agent" } });

      expect(mockMarkAccessed).toHaveBeenCalledWith("thread-with-agent");
      spy.mockRestore();
    });
  });

  describe("run", () => {
    test("delegates to invoke with the exact same arguments", async () => {
      // spy on wrapper.invoke
      const mockInvoke = mock(() => Promise.resolve({ reply: "success" }));
      wrapper.invoke = mockInvoke as any;

      const res = await wrapper.run("hello", { threadId: "test-thread" });

      expect(mockInvoke).toHaveBeenCalledWith("hello", { threadId: "test-thread" });
      expect(res).toEqual({ reply: "success" });
    });
  });

  describe("stream", () => {
    test("delegates to agent.stream via prepareAgent and yields chunks", async () => {
      const mockChunks = [{ chunk: 1 }, { chunk: 2 }];

      async function* mockStreamGenerator() {
        for (const c of mockChunks) yield c;
      }

      const mockAgent = {
        stream: mock(() => mockStreamGenerator()),
      };

      // Mock prepareAgent since it's private and has complex sandbox/repo initialization
      (wrapper as any).prepareAgent = mock(() => Promise.resolve({
        agent: mockAgent,
        configurable: { configurable: true }
      }));

      const generator = wrapper.stream("hello", { threadId: "stream-thread" });

      const chunks = [];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      expect((wrapper as any).prepareAgent).toHaveBeenCalledWith("hello", "stream-thread");
      expect(mockAgent.stream).toHaveBeenCalledWith(
        { messages: [{ role: "user", content: "hello" }] },
        { configurable: { configurable: true } }
      );
      expect(chunks).toEqual(mockChunks);
    });
  });
});
