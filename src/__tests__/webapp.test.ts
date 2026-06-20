import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";

// Capture the REAL telegram module exports BEFORE we mock it below. The mock
// only needs to override isDuplicateMessage + sendChatAction for webapp, but
// Bun's mock.module replaces the module process-wide, so we spread the real
// exports to keep every named export (e.g. _clearDuplicateCache,
// formatCodeBlock, buildHitlKeyboard) available for any other test file
// (tests/utils/telegram.test.ts) loaded in the same process.
import * as realTelegram from "../utils/telegram";

const originalFetch = globalThis.fetch;




let mockLoadTelegramConfig: any;
let mockVerifyGithubSignature: any;
let mockExtractPrContext: any;
let mockFetchPrCommentsSinceLastTag: any;
let mockBuildPrPrompt: any;
let mockReactToGithubComment: any;
let mockGetThreadIdFromBranch: any;
let mockGetGithubAppInstallationToken: any;
let mockStoreGithubTokenInThread: any;
let mockPostGithubComment: any;
let mockGetGithubToken: any;
let mockGetEmailForIdentity: any;
let mockIsDuplicateMessage: any;
let mockSendChatAction: any;

// Export a mutable mock property for tests to change verifyGithubSignature behavior
export const mockVerifyGithubSignatureMutable = {
  returnValue: true
};

// Mock dependencies using mock.module BEFORE importing app
mock.module("../utils/config", () => ({
  loadTelegramConfig: () => ({ 
    telegramBotToken: "mock-bot-token",
    telegramParseMode: "HTML"
  })
}));

mock.module("../utils/github", () => ({
  verifyGithubSignature: () => mockVerifyGithubSignatureMutable.returnValue,
  extractPrContext: async () => [
    {} as any, 123, "main", "testuser", "https://github.com/pr", 1, "node-1"
  ],
  fetchPrCommentsSinceLastTag: async () => [{ body: "test comment" }],
  buildPrPrompt: () => "mock pr prompt",
  reactToGithubComment: async () => true,
  getThreadIdFromBranch: () => "mock-thread-id",
  getGithubAppInstallationToken: async () => "mock-app-token",
  storeGithubTokenInThread: async () => {},
  postGithubComment: async () => true,
  getGithubToken: () => "mock-gh-token",
}));

mock.module("../utils/identity", () => ({
  getEmailForIdentity: () => "test@example.com",
}));

// Spread the real telegram module so the mock is a superset of its exports.
// Other test files loaded in the same Bun process (tests/utils/telegram.test.ts)
// import the same absolute module path; without the spread, mock.module would
// strip their named exports (_clearDuplicateCache, buildHitlKeyboard, ...) and
// raise "Export named '...' not found". We keep sendChatAction as a noop to
// avoid live Telegram API calls, and let the real isDuplicateMessage run so we
// don't poison its module-level dedup Map for sibling test files.
mock.module("../utils/telegram", () => ({
  ...realTelegram,
  sendChatAction: async () => {},
}));

// Mock at the harness level (same as server.test.ts) to avoid poisoning
// the ../server module cache for other test files
const mockHarnessRun = mock(async (input: string) => ({
  reply: `Mocked reply for: ${input}`,
}));

mock.module("../harness", () => ({
  getAgentHarness: () => Promise.resolve({ run: mockHarnessRun }),
}));

mock.module("../utils/logger", () => ({
  createLogger: () => ({
    info: mock(), error: mock(), warn: mock(), debug: mock(),
  }),
}));

// Import AFTER mocks are set up
const { default: app } = await import("../webapp");
const server = await import("../server");

// Spy on the real runCodeagentTurn so we can assert call counts/args.
// Since harness is mocked, the real function just calls through to mockHarnessRun.
let runCodeagentTurnSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  mockHarnessRun.mockClear();
  runCodeagentTurnSpy = spyOn(server, "runCodeagentTurn");
});

afterEach(() => {
  runCodeagentTurnSpy.mockRestore();
});


describe("webapp", () => {
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    mockFetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }))),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    if (mockVerifyGithubSignature) mockVerifyGithubSignature.mockClear();
    mockVerifyGithubSignatureMutable.returnValue = true;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("GET /health", () => {
    it("returns healthy status", async () => {
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        status: "healthy",
        service: "codeagent",
      });
    });
  });

  describe("GET /info", () => {
    it("returns graph info", async () => {
      const res = await app.request("/info");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.name).toBe("codeagent");
      expect(data.version).toBe("2.0.0");
      expect(Array.isArray(data.middleware)).toBe(true);
    });
  });

  describe("POST /run", () => {
    it("returns 400 if input is missing or empty", async () => {
      const res1 = await app.request("/run", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      });
      expect(res1.status).toBe(400);

      const res2 = await app.request("/run", {
        method: "POST",
        body: JSON.stringify({ input: "   " }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res2.status).toBe(400);
    });

    it("processes input and returns result", async () => {
      const res = await app.request("/run", {
        method: "POST",
        body: JSON.stringify({ input: "hello world" }),
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result).toBe("Mocked reply for: hello world");
      expect(data.input).toBe("hello world");
      expect(data.state.replyLength).toBeGreaterThan(0);
      expect(runCodeagentTurnSpy).toHaveBeenCalledWith("hello world", expect.any(String), undefined, "http");
    });
  });

  describe("POST /v1/chat/completions", () => {
    it("returns 400 if last message is not from user", async () => {
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          messages: [{ role: "assistant", content: "hi" }],
        }),
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(400);
    });

    it("returns openai compatible response", async () => {
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "hello" }],
        }),
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.object).toBe("chat.completion");
      expect(data.model).toBe("test-model");
      expect(data.choices[0].message.role).toBe("assistant");
      expect(data.choices[0].message.content).toBe("Mocked reply for: hello");
      expect(data.usage.prompt_tokens).toBeGreaterThan(0);
    });
  });

  describe("POST /webhook/telegram", () => {
    it("processes message and calls telegram API", async () => {
      const res = await app.request("/webhook/telegram", {
        method: "POST",
        body: JSON.stringify({
          update_id: 12345,
          message: {
            message_id: 1,
            chat: { id: 98765 },
            text: "test message",
          },
        }),
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        message: "Message processing started",
      });
      // runCodeagentTurn is called async in queue, wait a tick
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(runCodeagentTurnSpy).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalled();
    });

    it("handles non-message updates gracefully", async () => {
      const res = await app.request("/webhook/telegram", {
        method: "POST",
        body: JSON.stringify({
          update_id: 12345,
          edited_message: { text: "edited" },
        }),
        headers: { "Content-Type": "application/json" },
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        message: "Update received",
      });
      expect(runCodeagentTurnSpy).not.toHaveBeenCalled();
    });
  });

  describe("POST /webhook/github", () => {
    it("returns 401 if missing signature", async () => {
      const res = await app.request("/webhook/github", {
        method: "POST",
        body: JSON.stringify({ action: "opened" }),
        headers: { "x-github-event": "issues" }, // Missing x-hub-signature-256
      });

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: "Missing X-Hub-Signature-256 header",
      });
    });

    it("returns 401 if invalid signature", async () => {
      // Temporarily mock it to fail
      mockVerifyGithubSignatureMutable.returnValue = false;

      const res = await app.request("/webhook/github", {
        method: "POST",
        body: JSON.stringify({ action: "opened" }),
        headers: {
          "x-github-event": "issues",
          "x-hub-signature-256": "sha256=invalid",
        },
      });

      expect(res.status).toBe(401);
    });

    it("handles ping event", async () => {
      const res = await app.request("/webhook/github", {
        method: "POST",
        body: JSON.stringify({ zen: "Responsive is better than fast." }),
        headers: {
          "x-github-event": "ping",
          "x-hub-signature-256": "sha256=valid",
        },
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, message: "Pong!" });
    });

    it("handles push event asynchronously", async () => {
      const res = await app.request("/webhook/github", {
        method: "POST",
        body: JSON.stringify({
          ref: "refs/heads/main",
          repository: { full_name: "test/repo" },
          commits: [{}],
        }),
        headers: {
          "x-github-event": "push",
          "x-hub-signature-256": "sha256=valid",
        },
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        message: "Push event received and processing started",
      });

      // runCodeagentTurn is called async, wait a tick
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(runCodeagentTurnSpy).toHaveBeenCalled();
    });
  });
});
