import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

const originalFetch = globalThis.fetch;

// Mock the required dependencies
mock.module("./server", () => {
  return {
    runCodeagentTurn: mock((input: string) => Promise.resolve(`Mocked reply for: ${input}`)),
  };
});

mock.module("./utils/logger", () => {
  return {
    createLogger: () => ({
      info: mock(),
      warn: mock(),
      error: mock(),
    }),
  };
});

mock.module("./utils/config", () => {
  return {
    loadTelegramConfig: mock(() => ({ telegramBotToken: "mock-bot-token" })),
  };
});

// We need to mutate verifyGithubSignature per test, so let's export a mutable mock
let mockVerifyGithubSignature = mock(() => true);

mock.module("./utils/github", () => {
  return {
    verifyGithubSignature: (...args: any[]) => mockVerifyGithubSignature(...args),
    extractPrContext: mock(() => Promise.resolve([
      {}, 123, "main", "testuser", "https://github.com/pr", "comment-1", "node-1"
    ])),
    fetchPrCommentsSinceLastTag: mock(() => Promise.resolve([{ body: "test comment" }])),
    buildPrPrompt: mock(() => "mock pr prompt"),
    reactToGithubComment: mock(() => Promise.resolve()),
    getThreadIdFromBranch: mock(() => Promise.resolve("mock-thread-id")),
    getGithubAppInstallationToken: mock(() => Promise.resolve("mock-app-token")),
    storeGithubTokenInThread: mock(() => Promise.resolve()),
    postGithubComment: mock(() => Promise.resolve()),
    getGithubToken: mock(() => "mock-gh-token"),
  };
});

mock.module("./utils/identity", () => {
  return {
    getEmailForIdentity: mock(() => "test@example.com"),
  };
});

// Important: Import app AFTER setting up the mocks
const { default: app } = await import("./webapp");
const { runCodeagentTurn } = await import("./server");
const githubUtils = await import("./utils/github");

describe("webapp", () => {
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    mockFetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true })))
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    mock.restore(); // reset general call counts
    // Reset our specific mocks
    runCodeagentTurn.mockClear();
    mockVerifyGithubSignature.mockClear();
    mockVerifyGithubSignature.mockImplementation(() => true);
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
      expect(runCodeagentTurn).toHaveBeenCalledWith("hello world");
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
      expect(await res.json()).toEqual({ ok: true, message: "Message processed" });
      expect(runCodeagentTurn).toHaveBeenCalled();
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
      expect(await res.json()).toEqual({ ok: true, message: "Update received" });
      expect(runCodeagentTurn).not.toHaveBeenCalled();
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
      expect(await res.json()).toEqual({ error: "Missing X-Hub-Signature-256 header" });
    });

    it("returns 401 if invalid signature", async () => {
      // Temporarily mock it to fail
      mockVerifyGithubSignature.mockImplementation(() => false);

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
      expect(await res.json()).toEqual({ ok: true, message: "Push event received and processing started" });

      // runCodeagentTurn is called async, wait a tick
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(runCodeagentTurn).toHaveBeenCalled();
    });
  });
});
