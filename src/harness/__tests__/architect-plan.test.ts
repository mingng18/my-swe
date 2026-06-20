import {
  describe,
  test,
  expect,
  mock,
  beforeEach,
  afterEach,
  spyOn,
} from "bun:test";

// Mock the model factory BEFORE importing deepagents so we can observe
// createChatModel invocations and control the returned model. Other heavy
// modules are stubbed so importing deepagents does not pull in real SDKs.
mock.module("@daytonaio/sdk", () => ({}));
mock.module("../../sandbox/daytona-snapshot-integration", () => ({}));
mock.module("deepagents", () => ({}));
mock.module("@alibaba-group/opensandbox", () => ({}));
mock.module("@langchain/langgraph", () => ({}));
mock.module("langchain", () => ({}));
mock.module("zod", () => ({}));
mock.module("octokit", () => ({}));
mock.module("../../sandbox", () => ({}));
mock.module("../../utils/thread-metadata-store", () => ({
  loadPersistedThreadRepos: mock(async () => new Map()),
  persistThreadRepo: mock(() => Promise.resolve()),
  removePersistedThreadRepo: mock(() => Promise.resolve()),
}));

// Track createChatModel calls so we can assert which ModelConfig it received.
const createChatModelMock = mock(async (config: any) => ({
  invoke: mock(async () => ({
    content: "1. Step one\n2. Step two",
  })),
}));

// model-factory is imported by deepagents via ESM specifier "../utils/model-factory".
// Bun resolves the relative path, so we mock the same module path here.
mock.module("../../utils/model-factory", () => ({
  createChatModel: createChatModelMock,
  detectProvider: () => "openai",
}));

// Capture stream events emitted by emitStreamEvent so we can assert the
// architect call is wrapped in llm_start/llm_end with role='architect'.
type CapturedStreamEvent = {
  type: string;
  model?: string;
  role?: string;
  totalTokens?: number;
  timestamp: number;
};
const emitEventMock = mock((_threadId: string, _event: CapturedStreamEvent) => {});
mock.module("../../stream", () => ({
  streamRegistry: { emitEvent: emitEventMock },
}));

// Capture whether the Langfuse callback is attached, and stub the handler so
// importing langfuse-langchain never reaches the network.
const langfuseHandlerCtorMock = mock(function () {
  return { name: "MockLangfuseHandler" };
});
mock.module("langfuse-langchain", () => ({
  CallbackHandler: langfuseHandlerCtorMock,
}));
const isLangfuseEnabledMock = mock(() => false);
mock.module("../../utils/langfuse", () => ({
  isLangfuseEnabled: isLangfuseEnabledMock,
  flushLangfuse: mock(async () => {}),
  shutdownLangfuse: mock(async () => {}),
  createTrace: mock(() => null),
  maskSensitiveData: (s: string) => s,
}));

import { generateArchitectPlan } from "../deepagents";
import * as modelFactory from "../../utils/model-factory";

describe("Architect planning step (#497)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.MODEL = "gpt-4o";
    delete process.env.OPENAI_BASE_URL;
    createChatModelMock.mockClear();
    emitEventMock.mockClear();
    langfuseHandlerCtorMock.mockClear();
    isLangfuseEnabledMock.mockReturnValue(false);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("when Architect/Editor routing is ENABLED", () => {
    beforeEach(() => {
      process.env.ARCHITECT_MODEL = "architect-strong";
      process.env.EDITOR_MODEL = "editor-fast";
    });

    test("invokes createChatModel with the ARCHITECT model config", async () => {
      const plan = await generateArchitectPlan("Add a login page");

      expect(createChatModelMock).toHaveBeenCalledTimes(1);
      const passedConfig = createChatModelMock.mock.calls[0][0];
      expect(passedConfig.model).toBe("architect-strong");
      expect(passedConfig.role).toBe("architect");
      // The returned plan is forwarded to the editor's user message.
      expect(plan).toContain("Step one");
    });

    test("includes repo context in the planning call when provided", async () => {
      const invokeSpy = spyOn(modelFactory, "createChatModel");

      // After spyOn, the mock returned by mock.module is replaced by the spy;
      // restore its implementation so the test still resolves.
      invokeSpy.mockImplementation(async (config: any) => ({
        invoke: mock(async (_prompt: any) => {
          // Verify repo context reaches the prompt.
          const userMsg = _prompt[1];
          expect(userMsg.content).toContain("owner/repo");
          return { content: "plan text" };
        }),
      }) as any);

      await generateArchitectPlan("Fix the bug", {
        owner: "owner",
        name: "repo",
        workspaceDir: "/tmp/repo",
      });

      expect(invokeSpy).toHaveBeenCalledTimes(1);
      invokeSpy.mockRestore();
    });

    test("returns empty string and swallows planning failures (no throw)", async () => {
      // Force createChatModel to throw.
      createChatModelMock.mockImplementationOnce(async () => {
        throw new Error("network down");
      });

      const plan = await generateArchitectPlan("anything");

      // Best-effort: failures must NOT propagate across the async invoke path.
      expect(plan).toBe("");
    });

    test("emits llm_start-style attribution role on the architect model", async () => {
      await generateArchitectPlan("task");

      const passedConfig = createChatModelMock.mock.calls[0][0];
      expect(passedConfig.role).toBe("architect");
      expect(passedConfig.model).toBe("architect-strong");
    });

    test("emits NO stream events when threadId is not supplied (backward compat)", async () => {
      await generateArchitectPlan("task");

      // Without a threadId we cannot attribute the event to a stream; the
      // default path (no options) must remain a pure LLM call with no events.
      expect(emitEventMock).not.toHaveBeenCalled();
    });

    test("emits llm_start + llm_end stream events tagged role='architect' when threadId given", async () => {
      await generateArchitectPlan("task", undefined, { threadId: "t-1" });

      expect(emitEventMock).toHaveBeenCalledTimes(2);

      const [threadStart, startEvent] = emitEventMock.mock.calls[0];
      expect(threadStart).toBe("t-1");
      expect(startEvent.type).toBe("llm_start");
      expect(startEvent.model).toBe("architect-strong");
      expect(startEvent.role).toBe("architect");

      const [threadEnd, endEvent] = emitEventMock.mock.calls[1];
      expect(threadEnd).toBe("t-1");
      expect(endEvent.type).toBe("llm_end");
      expect(endEvent.role).toBe("architect");
    });

    test("emits a matching llm_end even when planning fails (no dangling llm_start)", async () => {
      // Make model.invoke throw AFTER the llm_start has been emitted, so the
      // catch path must emit a paired llm_end (otherwise the stream has a
      // start with no end).
      createChatModelMock.mockImplementationOnce(async () => ({
        invoke: mock(async () => {
          throw new Error("network down");
        }),
      }) as any);

      const plan = await generateArchitectPlan("task", undefined, {
        threadId: "t-err",
      });

      expect(plan).toBe("");
      // llm_start emitted before the throw, then a paired llm_end on the catch
      // path so the stream never has a start without an end.
      const types = emitEventMock.mock.calls.map((c) => c[1].type);
      expect(types).toEqual(["llm_start", "llm_end"]);
      const endEvent = emitEventMock.mock.calls[1][1];
      expect(endEvent.role).toBe("architect");
      expect(endEvent.totalTokens).toBe(0);
    });

    test("attaches the Langfuse callback to the invoke when Langfuse is enabled", async () => {
      isLangfuseEnabledMock.mockReturnValue(true);

      // Override the model.invoke mock so we can capture the options (2nd arg)
      // passed to invoke — that's where the callbacks array lives.
      const invokeMock = mock(async (_msgs: unknown, opts?: { callbacks?: unknown[] }) => ({
        content: "plan",
      }));
      createChatModelMock.mockImplementationOnce(async () => ({
        invoke: invokeMock,
      }) as any);

      await generateArchitectPlan("task", undefined, { threadId: "t-lf" });

      expect(langfuseHandlerCtorMock).toHaveBeenCalledTimes(1);
      expect(invokeMock).toHaveBeenCalledTimes(1);
      const invokeOptions = invokeMock.mock.calls[0][1];
      expect(Array.isArray(invokeOptions?.callbacks)).toBe(true);
      expect(invokeOptions!.callbacks![0]).toEqual({ name: "MockLangfuseHandler" });
    });

    test("does NOT attach Langfuse callback when Langfuse is disabled", async () => {
      isLangfuseEnabledMock.mockReturnValue(false);

      const invokeMock = mock(async (_msgs: unknown, opts?: { callbacks?: unknown[] }) => ({
        content: "plan",
      }));
      createChatModelMock.mockImplementationOnce(async () => ({
        invoke: invokeMock,
      }) as any);

      await generateArchitectPlan("task");

      const invokeOptions = invokeMock.mock.calls[0][1];
      // No callbacks key when Langfuse is off.
      expect(invokeOptions?.callbacks).toBeUndefined();
    });

    test("caps an over-long architect plan to the 2000-char bound", async () => {
      const longPlan = "x".repeat(5000);
      createChatModelMock.mockImplementationOnce(async () => ({
        invoke: mock(async () => ({ content: longPlan })),
      }) as any);

      const plan = await generateArchitectPlan("task");

      // Returned plan stays within a small envelope around the cap (cap + the
      // truncation notice line) and is marked as truncated.
      expect(plan.length).toBeLessThan(2100);
      expect(plan).toContain("[plan truncated");
    });

    test("does not truncate a plan under the cap", async () => {
      createChatModelMock.mockImplementationOnce(async () => ({
        invoke: mock(async () => ({ content: "short plan" })),
      }) as any);

      const plan = await generateArchitectPlan("task");

      expect(plan).toBe("short plan");
      expect(plan).not.toContain("[plan truncated");
    });
  });

  describe("when Architect/Editor routing is DISABLED (default)", () => {
    beforeEach(() => {
      delete process.env.ARCHITECT_MODEL;
      delete process.env.EDITOR_MODEL;
    });

    test("does NOT invoke the architect model (no planning call)", async () => {
      const plan = await generateArchitectPlan("Add a login page");

      // Default behavior: zero LLM calls, byte-for-byte today.
      expect(createChatModelMock).not.toHaveBeenCalled();
      expect(plan).toBe("");
    });

    test("is disabled when only ARCHITECT_MODEL is set", async () => {
      process.env.ARCHITECT_MODEL = "architect-strong";
      delete process.env.EDITOR_MODEL;

      const plan = await generateArchitectPlan("Add a login page");

      expect(createChatModelMock).not.toHaveBeenCalled();
      expect(plan).toBe("");
    });

    test("is disabled when only EDITOR_MODEL is set", async () => {
      delete process.env.ARCHITECT_MODEL;
      process.env.EDITOR_MODEL = "editor-fast";

      const plan = await generateArchitectPlan("Add a login page");

      expect(createChatModelMock).not.toHaveBeenCalled();
      expect(plan).toBe("");
    });

    test("is disabled when both are whitespace-only", async () => {
      process.env.ARCHITECT_MODEL = "   ";
      process.env.EDITOR_MODEL = "  ";

      const plan = await generateArchitectPlan("Add a login page");

      expect(createChatModelMock).not.toHaveBeenCalled();
      expect(plan).toBe("");
    });
  });
});
