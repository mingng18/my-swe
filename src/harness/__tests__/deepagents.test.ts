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
import { emitTodoEvent } from "../deepagents";
import { streamRegistry } from "../../stream";

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

describe("emitTodoEvent", () => {
  let emitEventSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    emitEventSpy = spyOn(streamRegistry, "emitEvent");
  });

  afterEach(() => {
    emitEventSpy.mockRestore();
  });

  test("should map 'add' event properly", () => {
    emitTodoEvent("thread-123", {
      type: "add",
      id: "todo-1",
      subject: "Test subject",
      status: "pending",
    });

    expect(emitEventSpy).toHaveBeenCalledTimes(1);
    expect(emitEventSpy).toHaveBeenCalledWith("thread-123", {
      type: "todo_added",
      id: "todo-1",
      subject: "Test subject",
      status: "pending",
    });
  });

  test("should map 'update' event properly", () => {
    emitTodoEvent("thread-123", {
      type: "update",
      id: "todo-1",
      status: "completed",
    });

    expect(emitEventSpy).toHaveBeenCalledTimes(1);
    expect(emitEventSpy).toHaveBeenCalledWith("thread-123", {
      type: "todo_updated",
      id: "todo-1",
      status: "completed",
    });
  });

  test("should map 'complete' event properly", () => {
    emitTodoEvent("thread-123", {
      type: "complete",
      id: "todo-1",
    });

    expect(emitEventSpy).toHaveBeenCalledTimes(1);
    expect(emitEventSpy).toHaveBeenCalledWith("thread-123", {
      type: "todo_completed",
      id: "todo-1",
    });
  });
});
