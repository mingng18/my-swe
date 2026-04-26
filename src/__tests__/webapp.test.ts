import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

const originalFetch = globalThis.fetch;



import { spyOn } from "bun:test";
import * as configUtils from "../utils/config";
import * as githubUtils from "../utils/github/index";
import * as identityUtils from "../utils/identity";
import * as telegramUtils from "../utils/telegram";

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

// Important: Import app AFTER setting up the mocks
const { default: app } = await import("../webapp");
import * as server from "../server";

beforeEach(() => {
  mockLoadTelegramConfig = spyOn(configUtils, "loadTelegramConfig").mockReturnValue({ 
    telegramBotToken: "mock-bot-token",
    telegramParseMode: "HTML"
  });
  mockVerifyGithubSignature = spyOn(githubUtils, "verifyGithubSignature").mockImplementation(() => mockVerifyGithubSignatureMutable.returnValue);
  mockExtractPrContext = spyOn(githubUtils, "extractPrContext").mockResolvedValue([
    {} as any, 123, "main", "testuser", "https://github.com/pr", 1, "node-1"
  ]);
  mockFetchPrCommentsSinceLastTag = spyOn(githubUtils, "fetchPrCommentsSinceLastTag").mockResolvedValue([{ body: "test comment" } as any]);
  mockBuildPrPrompt = spyOn(githubUtils, "buildPrPrompt").mockReturnValue("mock pr prompt");
  mockReactToGithubComment = spyOn(githubUtils, "reactToGithubComment").mockResolvedValue(true);
  mockGetThreadIdFromBranch = spyOn(githubUtils, "getThreadIdFromBranch").mockReturnValue("mock-thread-id");
  mockGetGithubAppInstallationToken = spyOn(githubUtils, "getGithubAppInstallationToken").mockResolvedValue("mock-app-token");
  mockStoreGithubTokenInThread = spyOn(githubUtils, "storeGithubTokenInThread").mockResolvedValue(undefined as any);
  mockPostGithubComment = spyOn(githubUtils, "postGithubComment").mockResolvedValue(true);
  mockGetGithubToken = spyOn(githubUtils, "getGithubToken").mockReturnValue("mock-gh-token");
  
  mockGetEmailForIdentity = spyOn(identityUtils, "getEmailForIdentity").mockReturnValue("test@example.com");
  
  mockIsDuplicateMessage = spyOn(telegramUtils, "isDuplicateMessage").mockReturnValue(false);
  mockSendChatAction = spyOn(telegramUtils, "sendChatAction").mockResolvedValue(undefined as any);
});

afterEach(() => {
  if (mockLoadTelegramConfig) mockLoadTelegramConfig.mockRestore();
  if (mockVerifyGithubSignature) mockVerifyGithubSignature.mockRestore();
  if (mockExtractPrContext) mockExtractPrContext.mockRestore();
  if (mockFetchPrCommentsSinceLastTag) mockFetchPrCommentsSinceLastTag.mockRestore();
  if (mockBuildPrPrompt) mockBuildPrPrompt.mockRestore();
  if (mockReactToGithubComment) mockReactToGithubComment.mockRestore();
  if (mockGetThreadIdFromBranch) mockGetThreadIdFromBranch.mockRestore();
  if (mockGetGithubAppInstallationToken) mockGetGithubAppInstallationToken.mockRestore();
  if (mockStoreGithubTokenInThread) mockStoreGithubTokenInThread.mockRestore();
  if (mockPostGithubComment) mockPostGithubComment.mockRestore();
  if (mockGetGithubToken) mockGetGithubToken.mockRestore();
  
  if (mockGetEmailForIdentity) mockGetEmailForIdentity.mockRestore();
  
  if (mockIsDuplicateMessage) mockIsDuplicateMessage.mockRestore();
  if (mockSendChatAction) mockSendChatAction.mockRestore();
});



afterEach(() => {
  if (mockIsDuplicateMessage) mockIsDuplicateMessage.mockRestore();
  if (mockSendChatAction) mockSendChatAction.mockRestore();
});


describe("webapp", () => {
  let mockFetch: ReturnType<typeof mock>;

  let mockRunCodeagentTurn: any;
  beforeEach(() => {
    mockFetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }))),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    mock.restore(); // reset general call counts
    // Reset our specific mocks
    mockRunCodeagentTurn = spyOn(server, "runCodeagentTurn").mockImplementation(async (input: string) => `Mocked reply for: ${input}`);
    if (mockVerifyGithubSignature) mockVerifyGithubSignature.mockClear();
    mockVerifyGithubSignatureMutable.returnValue = true;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (mockRunCodeagentTurn) {
      mockRunCodeagentTurn.mockRestore();
    }
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
      expect(server.runCodeagentTurn).toHaveBeenCalledWith("hello world", undefined, undefined, "http");
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
      expect(server.runCodeagentTurn).toHaveBeenCalled();
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
      expect(server.runCodeagentTurn).not.toHaveBeenCalled();
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
      expect(server.runCodeagentTurn).toHaveBeenCalled();
    });
  });
});
