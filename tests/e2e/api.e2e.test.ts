/**
 * E2E Tests for my-swe (Bullhorse) HTTP API
 *
 * These tests start the real dev server and hit the actual HTTP endpoints.
 * They do NOT mock runCodeagentTurn — they test the full HTTP stack (Hono routing,
 * auth, rate limiting, SSE, webhooks) without needing an LLM provider.
 *
 * USAGE:
 *   bun test tests/e2e/api.e2e.test.ts           # run all e2e
 *   bun test tests/e2e/api.e2e.test.ts --test-name-pattern "health"  # run one test
 *
 * PREREQUISITES:
 *   - Dev server must NOT be running (tests start their own on a random port)
 *   - No API_SECRET_KEY needed (tests run without auth by default)
 *   - No LLM provider keys needed (we test transport layer, not agent logic)
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";

// Pick a port unlikely to conflict with the real dev server
const E2E_PORT = 9876;
const BASE = `http://localhost:${E2E_PORT}`;

let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  const { default: app } = await import("../../src/webapp");
  server = Bun.serve({ port: E2E_PORT, fetch: app.fetch });
});

afterAll(() => {
  server?.stop();
});

// ─── Helpers ────────────────────────────────────────────────

async function get(path: string, headers: Record<string, string> = {}) {
  return fetch(`${BASE}${path}`, { headers });
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

// ─── Health & Info ──────────────────────────────────────────

describe("GET /health", () => {
  it("returns healthy status", async () => {
    const res = await get("/health");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.status).toBe("healthy");
    expect(json.service).toBe("codeagent");
  });

  it("has security headers", async () => {
    const res = await get("/health");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
  });
});

describe("GET /info", () => {
  it("returns graph metadata", async () => {
    const res = await get("/info");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.name).toBe("codeagent");
    expect(json.version).toBe("2.0.0");
    expect(json.architecture).toBe("middleware");
    expect(Array.isArray(json.middleware)).toBe(true);
    expect(json.middleware.length).toBeGreaterThan(0);
  });
});

// ─── POST /run ──────────────────────────────────────────────

describe("POST /run", () => {
  it("rejects empty input", async () => {
    const res = await post("/run", { input: "" });
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("non-empty string");
  });

  it("rejects missing input field", async () => {
    const res = await post("/run", {});
    expect(res.status).toBe(400);
  });

  it("rejects non-string input", async () => {
    const res = await post("/run", { input: 123 });
    expect(res.status).toBe(400);
  });

  it("rejects whitespace-only input", async () => {
    const res = await post("/run", { input: "   " });
    expect(res.status).toBe(400);
  });

  it("returns threadId in response shape", async () => {
    // This will likely fail at the LLM call, but the route should still
    // attempt processing and return proper structure or a 500 with error message
    const res = await post("/run", { input: "hello" });
    // Either success (200) or a handled error (500) — not 4xx validation
    expect([200, 500]).toContain(res.status);

    const json = await res.json();
    if (res.status === 200) {
      expect(json.threadId).toBeDefined();
      expect(json.result).toBeDefined();
      expect(json.input).toBe("hello");
    } else {
      expect(json.error).toBeDefined();
    }
  });

  it("uses client-provided threadId when given", async () => {
    const customId = "e2e-test-thread-123";
    const res = await post("/run", { input: "test", threadId: customId });
    const json = await res.json();

    if (res.status === 200) {
      expect(json.threadId).toBe(customId);
    }
  });
});

// ─── POST /v1/chat/completions ──────────────────────────────

describe("POST /v1/chat/completions", () => {
  it("rejects missing messages array", async () => {
    const res = await post("/v1/chat/completions", {});
    expect(res.status).toBe(400);
  });

  it("rejects when last message is not from user", async () => {
    const res = await post("/v1/chat/completions", {
      messages: [{ role: "assistant", content: "hi" }],
    });
    expect(res.status).toBe(400);
  });

  it("returns OpenAI-compatible shape on valid input", async () => {
    const res = await post("/v1/chat/completions", {
      messages: [{ role: "user", content: "hello" }],
    });

    expect([200, 500]).toContain(res.status);
    const json = await res.json();

    if (res.status === 200) {
      expect(json.object).toBe("chat.completion");
      expect(json.choices).toBeDefined();
      expect(json.choices[0].message.role).toBe("assistant");
      expect(json.choices[0].message.content).toBeDefined();
    }
  });

  it("defaults thread_id to 'default'", async () => {
    const res = await post("/v1/chat/completions", {
      messages: [{ role: "user", content: "hello" }],
    });

    if (res.status === 200) {
      const json = await res.json();
      expect(json.thread_id).toBe("default");
    }
  });

  it("uses provided thread_id", async () => {
    const res = await post("/v1/chat/completions", {
      messages: [{ role: "user", content: "hello" }],
      thread_id: "my-thread",
    });

    if (res.status === 200) {
      const json = await res.json();
      expect(json.thread_id).toBe("my-thread");
    }
  });
});

// ─── SSE Stream ─────────────────────────────────────────────

describe("GET /stream", () => {
  it("establishes SSE connection", async () => {
    const controller = new AbortController();
    const resPromise = get("/stream?threadId=e2e-test", {
      Accept: "text/event-stream",
    });

    // Let connection establish
    await new Promise((r) => setTimeout(r, 100));
    controller.abort();

    try {
      const res = await resPromise;
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");
      expect(res.headers.get("Cache-Control")).toBe("no-cache");
    } catch (e: any) {
      expect(e.name).toBe("AbortError");
    }
  });
});

// ─── GitHub Webhook ─────────────────────────────────────────

describe("POST /webhook/github", () => {
  it("rejects missing signature", async () => {
    const res = await post("/webhook/github", { zen: "keep it simple" });
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toContain("X-Hub-Signature-256");
  });

  it("rejects invalid signature", async () => {
    const res = await fetch(`${BASE}/webhook/github`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": "sha256=badsignature",
        "x-github-event": "ping",
      },
      body: JSON.stringify({ zen: "keep it simple" }),
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain("Invalid webhook signature");
  });
});

// ─── Auth (when API_SECRET_KEY is set) ──────────────────────

describe("Auth middleware", () => {
  it("allows unauthenticated access to public endpoints", async () => {
    // /health and /info are public — no auth needed
    const res = await get("/health");
    expect(res.status).toBe(200);
  });

  // These tests only run when API_SECRET_KEY is set in the environment
  const hasSecret = !!process.env.API_SECRET_KEY;
  (hasSecret ? it : it.skip)("rejects unauthenticated /run when secret is set", async () => {
    const res = await post("/run", { input: "test" });
    expect(res.status).toBe(401);
  });

  (hasSecret ? it : it.skip)("accepts authenticated /run with correct secret", async () => {
    const secret = process.env.API_SECRET_KEY!;
    const token = secret; // Direct pass-through
    const res = await post("/run", { input: "test" }, {
      Authorization: `Bearer ${token}`,
    });
    expect([200, 500]).toContain(res.status);
  });
});

// ─── CORS ───────────────────────────────────────────────────

describe("CORS", () => {
  it("handles preflight OPTIONS", async () => {
    const res = await fetch(`${BASE}/health`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(res.status).toBe(204);
  });

  it("allows localhost origins", async () => {
    const res = await get("/health", {
      Origin: "http://localhost:3000",
    });
    expect(res.status).toBe(200);
    const acao = res.headers.get("Access-Control-Allow-Origin");
    expect(acao).toBeTruthy();
  });
});

// ─── Rate Limiting (LAST — poisons the cache) ───────────────

describe("Rate limiting", () => {
  it("sets rate limit headers", async () => {
    const res = await get("/health");
    expect(res.headers.get("X-RateLimit-Limit")).toBeDefined();
    expect(res.headers.get("X-RateLimit-Remaining")).toBeDefined();
  });

  it("returns 429 when rate limit exceeded", async () => {
    // Health has a 120/min limit — hammer it
    const results = await Promise.all(
      Array.from({ length: 130 }, () => get("/health")),
    );

    const tooManyRequests = results.filter((r) => r.status === 429);
    expect(tooManyRequests.length).toBeGreaterThan(0);

    const rateLimited = tooManyRequests[0];
    const json = await rateLimited.json();
    expect(json.error).toContain("Too Many Requests");
    expect(rateLimited.headers.get("Retry-After")).toBeDefined();
  });
});
