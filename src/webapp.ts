import { createHash, timingSafeEqual } from "crypto";
import { createLogger } from "./utils/logger";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as httpLogger } from "hono/logger";

import { runCodeagentTurn, getLoopRunner } from "./server";
import { runSelfImprovementCycle } from "./loop/self-improve/orchestrator";
import {
  createEvalRunner,
  loadEvalCasesFromEnv,
} from "./loop/self-improve/eval-runner";
import { streamRegistry } from "./stream";
import { LRUCache } from "lru-cache";

// Security headers
// (Moved below app declaration)

import { handleGithubWebhook } from "./webhooks/github";
import { handleTelegramWebhook } from "./webhooks/telegram";
import { verifyGithubSignature } from "./utils/github";

const log = createLogger("webapp");

// In-memory rate limiter with configurable limits
const rateLimitCache = new LRUCache<string, number>({
  max: 5000,
  ttl: 60 * 1000, // 1 minute window
});

// Configurable rate limits from environment
const rateLimitRun = Number.parseInt(process.env.RATE_LIMIT_RUN || "20", 10);
const rateLimitChat = Number.parseInt(process.env.RATE_LIMIT_CHAT || "20", 10);
const rateLimitWebhook = Number.parseInt(
  process.env.RATE_LIMIT_WEBHOOK || "60",
  10,
);
const rateLimitHealth = Number.parseInt(
  process.env.RATE_LIMIT_HEALTH || "120",
  10,
);

const rateLimiter = (limitPerMinute: number) => async (c: any, next: any) => {
  const ip =
    c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
  const path = c.req.path;
  const key = `${ip}:${path}`;

  const count = rateLimitCache.get(key) || 0;

  // Set rate limit headers on every response
  c.header("X-RateLimit-Limit", String(limitPerMinute));
  c.header(
    "X-RateLimit-Remaining",
    String(Math.max(0, limitPerMinute - count - 1)),
  );

  if (count >= limitPerMinute) {
    const retryAfter = 60;
    c.header("Retry-After", String(retryAfter));
    log.warn(
      { ip, path, limit: limitPerMinute },
      "[webapp] Rate limit exceeded",
    );
    return c.json({ error: "Too Many Requests", retry_after: retryAfter }, 429);
  }

  await next();
  rateLimitCache.set(key, count + 1);
};

const app = new Hono();

// Middleware
// Note: secureHeaders with crossOriginResourcePolicy causes issues with SSE
// so we selectively apply it, excluding cross-origin restrictive headers
app.use("*", async (c, next) => {
  // Set security headers manually, allowing cross-origin for SSE
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "SAMEORIGIN");
  c.header("X-DNS-Prefetch-Control", "off");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-XSS-Protection", "0");
  // Note: NOT setting Cross-Origin-Resource-Policy to allow SSE from dev server
  await next();
});
app.use("*", httpLogger());

// Apply rate limits to public webhooks and expensive endpoints
app.use("/webhook/*", rateLimiter(rateLimitWebhook));
app.use("/run", rateLimiter(rateLimitRun));
app.use("/v1/chat/completions", rateLimiter(rateLimitChat));
app.use("/health", rateLimiter(rateLimitHealth));
app.use("/info", rateLimiter(rateLimitHealth));
app.use("/dashboard/*", rateLimiter(rateLimitHealth));
app.use("/metrics", rateLimiter(rateLimitHealth));
app.use("/metrics/*", rateLimiter(rateLimitHealth));
app.use(
  "*",
  cors({
    origin: (origin) => {
      const allowedOrigin = process.env.CORS_ALLOWED_ORIGIN;
      if (
        process.env.NODE_ENV !== "production" &&
        origin &&
        /^http:\/\/(localhost|127\.0\.0\.1):(3000|3001)$/.test(origin)
      ) {
        return origin;
      }
      if (!origin || !allowedOrigin) return "";
      return origin === allowedOrigin ? origin : "";
    },
    allowMethods: ["POST", "GET", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-User-Id"],
  }),
);

// Authentication Middleware
app.use(async (c, next) => {
  const path = c.req.path;
  // Skip auth for public endpoints like webhooks, health checks, and stream
  if (
    path.startsWith("/webhook/") ||
    path === "/health" ||
    path === "/info" ||
    path === "/stream"
  ) {
    return next();
  }
  const secret = process.env.API_SECRET_KEY;
  if (secret) {
    const authHeader = c.req.header("Authorization");
    const token = authHeader
      ? authHeader.replace(/^Bearer\s+/i, "")
      : (c.req.query("token") ?? "");

    const expectedHash = createHash("sha256").update(secret).digest();
    const providedHash = createHash("sha256").update(token).digest();

    if (!timingSafeEqual(expectedHash, providedHash)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
  }
  await next();
});

/**
 * Health check endpoint
 */
app.get("/health", (c) => {
  return c.json({ status: "healthy", service: "codeagent" });
});

/**
 * Get graph info
 */
app.get("/info", (c) => {
  return c.json({
    name: "codeagent",
    version: "2.0.0",
    description: "Single Deep Agent with prebuilt middleware pipeline",
    architecture: "middleware",
    middleware: [
      "todoListMiddleware",
      "modelRetryMiddleware",
      "toolRetryMiddleware",
      "modelCallLimitMiddleware",
      "summarizationMiddleware",
      "contextEditingMiddleware",
      "loopDetectionMiddleware",
      "ensureNoEmptyMsgMiddleware",
    ],
  });
});

/**
 * Run the agent with a text input
 *
 * POST /run
 * Body: { "input": "your message here" }
 */
app.post("/run", async (c) => {
  try {
    const { input, threadId: clientThreadId } = await c.req.json();
    const userId = c.req.header("X-User-Id") || undefined;

    if (typeof input !== "string" || !input.trim()) {
      return c.json(
        { error: "Invalid input: 'input' must be a non-empty string" },
        400,
      );
    }

    // Use client-provided threadId or generate a new one
    const threadId = clientThreadId ?? crypto.randomUUID();

    const out = await runCodeagentTurn(input, threadId, userId, "http");

    return c.json({
      threadId,
      result: out,
      input,
      state: {
        replyLength: out.length,
      },
    });
  } catch (error) {
    log.error({ error }, "[webapp] /run error");
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});

// GET /loop/:threadId/status — pending HITL request (if any) + last loop state
app.get("/loop/:threadId/status", (c) => {
  const threadId = c.req.param("threadId");
  const runner = getLoopRunner();
  const hitl = runner.hitlStore.getByThread(threadId);
  return c.json({ threadId, pendingHITL: hitl ?? null });
});

// POST /loop/:threadId/resume — resolve a pending HITL request
app.post("/loop/:threadId/resume", async (c) => {
  const threadId = c.req.param("threadId");
  const body = (await c.req.json().catch(() => ({}))) as {
    requestId?: string;
    decision?: "approve" | "reject" | "modify";
    note?: string;
  };
  const runner = getLoopRunner();
  const req = body.requestId
    ? runner.hitlStore.get(body.requestId)
    : runner.hitlStore.getByThread(threadId);
  if (!req) return c.json({ error: "no pending HITL request" }, 404);
  if (!body.decision) return c.json({ error: "decision required" }, 400);
  const resolved = runner.hitlStore.resolve(
    req.requestId,
    body.decision,
    body.note,
  );
  return c.json({ threadId, resolved });
});

// POST /loop/self-improve — env-gated self-improvement cycle (L4).
// Off by default; requires LOOP_SELF_IMPROVE_ENABLED=true. Proposes eval-gated
// config deltas, records decisions, and HITL-requests accepted deltas. v1 does
// NOT auto-mutate harness config — applying is HITL-gated and deferred.
//
// Eval runner is opt-in: with no LOOP_SELF_IMPROVE_EVAL_CASES configured the
// cycle uses a conservative default that returns the current pass-rate (never
// improves => always rejects), so the endpoint is safe by default. Set
// LOOP_SELF_IMPROVE_EVAL_CASES to inline JSON or a path to a JSON file of
// EvalCase[] to swap in a real runner backed by EvalHarness.
app.post("/loop/self-improve", async (c) => {
  if (process.env.LOOP_SELF_IMPROVE_ENABLED !== "true") {
    return c.json(
      {
        error:
          "self-improvement is disabled (set LOOP_SELF_IMPROVE_ENABLED=true)",
      },
      403,
    );
  }
  const runner = getLoopRunner();
  // Eval runner: a real EvalHarness run is heavy; by default we expose the cycle
  // with a conservative eval runner that returns the current pass-rate (no change
  // => reject), so the endpoint is safe by default. When an operator configures a
  // fixed set of eval cases via LOOP_SELF_IMPROVE_EVAL_CASES (inline JSON or a path
  // to a JSON file), we swap in a real runner backed by EvalHarness instead.
  const evalCases = loadEvalCasesFromEnv(
    process.env.LOOP_SELF_IMPROVE_EVAL_CASES,
  );
  const evalRunner = evalCases
    ? createEvalRunner({ cases: evalCases })
    : async () => {
        const traces = runner.traceStore.queryAll();
        const passed = traces.filter((t) => t.outcome === "passed").length;
        return traces.length ? passed / traces.length : 0;
      };
  const res = await runSelfImprovementCycle({
    traceStore: runner.traceStore,
    evalRunner,
    hitlStore: runner.hitlStore,
    enabled: true,
  });
  return c.json(res);
});

/**
 * Chat completion style endpoint (compatible with OpenAI format)
 *
 * POST /v1/chat/completions
 * Body: {
 *   "messages": [{"role": "user", "content": "..."}],
 *   "thread_id": "optional-conversation-id"  // maintains conversation history
 * }
 */
app.post("/v1/chat/completions", async (c) => {
  try {
    const body = await c.req.json();
    const userMessage = body.messages?.[body.messages.length - 1];

    if (!userMessage || userMessage.role !== "user") {
      return c.json({ error: "Last message must be from user" }, 400);
    }

    const input =
      typeof userMessage.content === "string"
        ? userMessage.content
        : JSON.stringify(userMessage.content);

    // Optional thread_id for conversation history (defaults to "default")
    const threadId = body.thread_id || "default";

    const out = await runCodeagentTurn(input, threadId, undefined, "http");

    return c.json({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: body.model || "codeagent",
      thread_id: threadId,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: out,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: input.length,
        completion_tokens: out.length,
        total_tokens: input.length + out.length,
      },
    });
  } catch (error) {
    log.error({ error }, "[webapp] /v1/chat/completions error");
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});

/**
 * Telegram Webhook endpoint
 * POST /webhook/telegram
 * Receives updates from Telegram and processes them
 */
app.post("/webhook/telegram", async (c) => {
  try {
    const body = await c.req.json();
    const update = body as any;

    log.info(
      {
        updateId: update.update_id,
        type: Object.keys(update).find((k) => k !== "update_id") ?? "unknown",
      },
      "[webapp][telegram] update received",
    );

    const result = await handleTelegramWebhook(update);
    return c.json(result);
  } catch (error) {
    log.error({ error }, "[webapp] /webhook/telegram error");
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});

/**
 * GitHub Webhook endpoint
 * POST /webhook/github
 * Receives events from GitHub (e.g., PR, issue, push)
 */
app.post("/webhook/github", async (c) => {
  try {
    const signature = c.req.header("x-hub-signature-256");
    if (!signature) {
      return c.json({ error: "Missing X-Hub-Signature-256 header" }, 401);
    }

    const rawBody = await c.req.raw.clone().arrayBuffer();
    const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim() || "";
    if (!verifyGithubSignature(new Uint8Array(rawBody), signature, secret)) {
      log.warn("[webapp][github] Invalid webhook signature");
      return c.json({ error: "Invalid webhook signature" }, 401);
    }

    const payload = JSON.parse(Buffer.from(rawBody).toString("utf-8"));
    const githubEvent = c.req.header("x-github-event");

    log.info(
      {
        event: githubEvent,
        action: payload.action,
        repository: payload.repository?.full_name,
      },
      "[webapp][github] webhook received",
    );

    handleGithubWebhook(payload, githubEvent ?? "");

    if (githubEvent === "ping") {
      return c.json({ ok: true, message: "Pong!" });
    }

    if (githubEvent === "push") {
      return c.json({
        ok: true,
        message: "Push event received and processing started",
      });
    }

    return c.json({ ok: true, message: "Event received" });
  } catch (error) {
    log.error({ error }, "[webapp] /webhook/github error");
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});

/**
 * Rewind a thread to a prior checkpoint.
 *
 * POST /rewind/:threadId/:checkpointId
 *
 * Restores the thread's checkpointer state to the requested checkpoint using
 * the existing LangGraph MemorySaver (see `src/harness/deepagents.ts`). Returns
 * 404 when the checkpoint id is unknown for the thread.
 */
app.post("/rewind/:threadId/:checkpointId", async (c) => {
  const { threadId, checkpointId } = c.req.param();

  try {
    const { threadManager } = await import("./harness/thread-manager");
    const { restoreCheckpoint, CheckpointNotFoundError } =
      await import("./tools/checkpoint-rewind");

    const agent = threadManager.getAgent(threadId);
    if (!agent) {
      return c.json(
        {
          error: `No active agent for thread '${threadId}'.`,
          threadId,
          checkpointId,
        },
        404,
      );
    }

    let restored;
    try {
      restored = await restoreCheckpoint(agent, threadId, checkpointId);
    } catch (error) {
      if (error instanceof CheckpointNotFoundError) {
        return c.json(
          {
            error: error.message,
            threadId,
            checkpointId,
          },
          404,
        );
      }
      throw error;
    }

    return c.json({
      success: true,
      threadId,
      checkpointId,
      restoredAt: new Date().toISOString(),
      next: restored.next ?? [],
      messageCount: (() => {
        const v = restored.values as Record<string, unknown> | undefined;
        return Array.isArray(v?.messages) ? v!.messages.length : undefined;
      })(),
    });
  } catch (error) {
    log.error({ error, threadId, checkpointId }, "[webapp] /rewind error");
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});

/**
 * Metrics endpoint for a specific thread
 * GET /metrics/thread/:threadId
 */
app.get("/metrics/thread/:threadId", async (c) => {
  const { threadId } = c.req.param();
  const [{ getThreadMetrics }, { getTokenUsage }] = await Promise.all([
    import("./utils/telemetry"),
    import("./utils/token-tracker"),
  ]);

  try {
    const telemetryMetrics = getThreadMetrics(threadId);
    const tokenUsage = getTokenUsage(threadId);

    return c.json({
      threadId,
      telemetry: telemetryMetrics,
      tokenUsage: tokenUsage || {
        threadId,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        callCount: 0,
        lastUpdated: Date.now(),
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    log.error({ error, threadId }, "[webapp] /metrics/thread error");
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});

/**
 * Global metrics endpoint
 * GET /metrics
 */
app.get("/metrics", async (c) => {
  const [{ getTelemetryStatus }, { getTokenStats, getAllThreadUsage }] =
    await Promise.all([
      import("./utils/telemetry"),
      import("./utils/token-tracker"),
    ]);

  try {
    const telemetryStatus = getTelemetryStatus();
    const tokenStats = getTokenStats();
    const allThreads = getAllThreadUsage();

    return c.json({
      telemetry: telemetryStatus,
      tokens: tokenStats,
      threads: {
        count: allThreads.length,
        recent: allThreads.slice(0, 10).map((t) => ({
          threadId: t.threadId,
          totalTokens: t.totalTokens,
          totalCost: t.totalCost,
          callCount: t.callCount,
        })),
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    log.error({ error }, "[webapp] /metrics error");
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});

/**
 * SSE stream endpoint for real-time agent execution events
 * GET /stream?threadId=:threadId
 */
app.get("/stream", async (c) => {
  const threadId = c.req.query("threadId") || "default-session";

  // Create SSE stream
  const stream = streamRegistry.createStream(threadId);

  // Mark client as connected and emit initial event
  streamRegistry.markClientConnected(threadId);

  // Emit a session_start event to confirm connection
  streamRegistry.emitEvent(threadId, {
    type: "session_start",
    threadId,
    timestamp: Date.now(),
  });

  // Return Response with stream directly
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
      "Access-Control-Allow-Origin": c.req.header("Origin") || "*",
      Vary: "Origin",
    },
  });
});

/**
 * Tool usage analytics endpoint
 * GET /analytics/tools
 */
app.get("/analytics/tools", async (c) => {
  const { getGlobalToolMetrics } = await import("./utils/telemetry");

  try {
    const tools = getGlobalToolMetrics();

    return c.json({
      tools,
      timestamp: Date.now(),
    });
  } catch (error) {
    log.error({ error }, "[webapp] /analytics/tools error");
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});

/**
 * Trace dashboard for a specific thread (HTML)
 * GET /dashboard/thread/:threadId
 */
app.get("/dashboard/thread/:threadId", async (c) => {
  const { threadId } = c.req.param();
  const { generateTraceDashboardHTML } =
    await import("./utils/trace-dashboard");

  try {
    const html = generateTraceDashboardHTML(threadId);
    return c.html(html);
  } catch (error) {
    log.error({ error, threadId }, "[webapp] /dashboard/thread error");
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});

/**
 * Trace summary for a specific thread (JSON)
 * GET /trace/:threadId
 */
app.get("/trace/:threadId", async (c) => {
  const { threadId } = c.req.param();
  const { generateTraceSummaryJSON } = await import("./utils/trace-dashboard");

  try {
    const summary = generateTraceSummaryJSON(threadId);
    return c.json(JSON.parse(summary));
  } catch (error) {
    log.error({ error, threadId }, "[webapp] /trace error");
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});

/**
 * Memory consolidation endpoints
 */

/**
 * Trigger immediate consolidation for a thread
 * POST /api/memory/consolidate
 */
app.post("/api/memory/consolidate", async (c) => {
  try {
    const { threadId } = await c.req.json();

    if (!threadId || typeof threadId !== "string") {
      return c.json(
        { error: "threadId is required and must be a string" },
        400,
      );
    }

    const { getMemoryDaemon } = await import("./memory/daemon");
    const daemon = getMemoryDaemon();

    const result = await daemon.triggerConsolidation(threadId);

    if (!result.success) {
      return c.json({ error: result.error }, 500);
    }

    return c.json({
      success: true,
      threadId,
      result: result.result,
    });
  } catch (error) {
    log.error({ error }, "[webapp] /api/memory/consolidate error");
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});

/**
 * Get consolidation daemon status
 * GET /api/memory/consolidation/status
 */
app.get("/api/memory/consolidation/status", async (c) => {
  try {
    const { getMemoryDaemon } = await import("./memory/daemon");
    const daemon = getMemoryDaemon();

    const status = daemon.getStatus();

    return c.json(status);
  } catch (error) {
    log.error({ error }, "[webapp] /api/memory/consolidation/status error");
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});

/**
 * Get registered consolidation sessions
 * GET /api/memory/consolidation/sessions
 */
app.get("/api/memory/consolidation/sessions", async (c) => {
  try {
    const { getMemoryDaemon } = await import("./memory/daemon");
    const daemon = getMemoryDaemon();

    const sessions = daemon.getRegisteredSessions();

    return c.json({
      sessions,
      count: sessions.length,
    });
  } catch (error) {
    log.error({ error }, "[webapp] /api/memory/consolidation/sessions error");
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});

/**
 * Start the consolidation daemon
 * POST /api/memory/consolidation/start
 */
app.post("/api/memory/consolidation/start", async (c) => {
  try {
    const { getMemoryDaemon } = await import("./memory/daemon");
    const daemon = getMemoryDaemon();

    daemon.start();

    const status = daemon.getStatus();

    return c.json({
      success: true,
      message: "Consolidation daemon started",
      status,
    });
  } catch (error) {
    log.error({ error }, "[webapp] /api/memory/consolidation/start error");
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});

/**
 * Stop the consolidation daemon
 * POST /api/memory/consolidation/stop
 */
app.post("/api/memory/consolidation/stop", async (c) => {
  try {
    const { getMemoryDaemon } = await import("./memory/daemon");
    const daemon = getMemoryDaemon();

    daemon.stop();

    const status = daemon.getStatus();

    return c.json({
      success: true,
      message: "Consolidation daemon stopped",
      status,
    });
  } catch (error) {
    log.error({ error }, "[webapp] /api/memory/consolidation/stop error");
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});

export default app;
