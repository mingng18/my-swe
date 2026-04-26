import { createHash, timingSafeEqual } from "crypto";
import { createLogger } from "./utils/logger";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as httpLogger } from "hono/logger";

import { runCodeagentTurn } from "./server";
import { isDuplicateMessage, sendChatAction } from "./utils/telegram";
import { secureHeaders } from "hono/secure-headers";
import { LRUCache } from "lru-cache";

// Security headers
// (Moved below app declaration)

// In-memory rate limiter
const rateLimitCache = new LRUCache<string, number>({
  max: 5000,
  ttl: 60 * 1000, // 1 minute window
});

const rateLimiter = (limitPerMinute: number) => async (c: any, next: any) => {
  const ip =
    c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
  const path = c.req.path;
  const key = `${ip}:${path}`;

  const count = rateLimitCache.get(key) || 0;
  if (count >= limitPerMinute) {
    log.warn({ ip, path }, "[webapp] Rate limit exceeded");
    return c.json({ error: "Too Many Requests" }, 429);
  }
  rateLimitCache.set(key, count + 1);
  await next();
};

// (Rate limiter applied below app declaration)

// Message queue for concurrent requests
interface QueueItem {
  chatId: number;
  text: string;
}
const messageQueue = new Map<string, QueueItem[]>();
const activeThreads = new Set<string>();

/**
 * Generate a deterministic thread ID from a Telegram chat ID.
 */
function generateThreadId(chatId: number): string {
  return createHash("md5")
    .update(chatId.toString())
    .digest("hex")
    .substring(0, 16);
}

/**
 * Check if a thread is currently processing a request.
 */
function isThreadActive(threadId: string): boolean {
  return activeThreads.has(threadId);
}

/**
 * Enqueue a message for processing when the thread becomes available.
 */
function enqueueMessage(threadId: string, chatId: number, text: string): void {
  if (!messageQueue.has(threadId)) {
    messageQueue.set(threadId, []);
  }
  messageQueue.get(threadId)!.push({ chatId, text });

  if (!activeThreads.has(threadId)) {
    processThreadQueue(threadId).catch((err) => {
      log.error({ err, threadId }, "[webapp] Error in processThreadQueue");
    });
  }
}

/**
 * Process the queue for a specific thread sequentially.
 */
async function processThreadQueue(threadId: string): Promise<void> {
  if (activeThreads.has(threadId)) return;
  activeThreads.add(threadId);

  try {
    const { telegramBotToken } = loadTelegramConfig();
    const queue = messageQueue.get(threadId);

    while (queue && queue.length > 0) {
      const item = queue.shift();
      if (!item) continue;

      try {
        const reply = await runCodeagentTurn(
          item.text,
          threadId,
          undefined,
          "telegram",
        );

        if (telegramBotToken) {
          await fetch(
            `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: item.chatId,
                text: reply,
              }),
            },
          );
        }
      } catch (err) {
        log.error(
          { err, threadId },
          "[webapp] Error processing message in queue",
        );
        if (telegramBotToken) {
          await fetch(
            `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: item.chatId,
                text: "Sorry, I encountered an error.",
              }),
            },
          );
        }
      }
    }
  } finally {
    activeThreads.delete(threadId);
  }
}
import { loadTelegramConfig } from "./utils/config";
import {
  verifyGithubSignature,
  extractPrContext,
  fetchPrCommentsSinceLastTag,
  buildPrPrompt,
  reactToGithubComment,
  getThreadIdFromBranch,
  getGithubAppInstallationToken,
  storeGithubTokenInThread,
  postGithubComment,
  getGithubToken,
} from "./utils/github";
import { getEmailForIdentity } from "./utils/identity";

const log = createLogger("webapp");

const app = new Hono();

// Middleware
app.use("*", secureHeaders());
app.use("*", httpLogger());

// Apply rate limits to public webhooks and expensive endpoints
app.use("/webhook/*", rateLimiter(60));
app.use("/run", rateLimiter(20));
app.use("/v1/chat/completions", rateLimiter(20));
app.use(
  "*",
  cors({
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
    allowMethods: ["POST", "GET", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-User-Id"],
  }),
);

// Authentication Middleware
app.use(async (c, next) => {
  const path = c.req.path;
  // Skip auth for public endpoints like webhooks and health checks
  if (path.startsWith("/webhook/") || path === "/health" || path === "/info") {
    return next();
  }
  const secret = process.env.API_SECRET_KEY;
  if (secret) {
    const authHeader = c.req.header("Authorization");
    const token = authHeader
      ? authHeader.replace(/^Bearer\s+/i, "")
      : c.req.query("token");

    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const tokenBuffer = Buffer.from(token);
    const secretBuffer = Buffer.from(secret);

    if (
      tokenBuffer.length !== secretBuffer.length ||
      !timingSafeEqual(tokenBuffer, secretBuffer)
    ) {
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
    const { input, threadId } = await c.req.json();
    const userId = c.req.header("X-User-Id") || undefined;

    if (typeof input !== "string" || !input.trim()) {
      return c.json(
        { error: "Invalid input: 'input' must be a non-empty string" },
        400,
      );
    }

    const out = await runCodeagentTurn(input, threadId, userId, "http");

    return c.json({
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
    const { telegramBotToken, telegramParseMode } = loadTelegramConfig();

    const body = await c.req.json();
    const update = body as any;

    log.info(
      {
        updateId: update.update_id,
        type: Object.keys(update).find((k) => k !== "update_id") ?? "unknown",
      },
      "[webapp][telegram] update received",
    );

    // Handle message updates
    if ("message" in update) {
      const msg = update.message;
      if ("text" in msg && msg.text) {
        // Skip duplicate messages
        if (isDuplicateMessage(msg.chat.id, msg.message_id)) {
          return c.json({ ok: true, message: "Duplicate ignored" });
        }

        log.info(
          {
            chatId: msg.chat.id,
            messageId: msg.message_id,
            textLength: msg.text.length,
          },
          "[webapp][telegram] message",
        );

        // Generate threadId from chat ID for per-chat conversation history
        const threadId = generateThreadId(msg.chat.id);

        // Check if thread is active, queue if busy
        if (isThreadActive(threadId)) {
          log.info(
            { threadId, chatId: msg.chat.id },
            "[webapp][telegram] thread busy, queuing message",
          );
          enqueueMessage(threadId, msg.chat.id, msg.text);
          // Send acknowledgment
          await fetch(
            `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: msg.chat.id,
                text: "Message queued. I'll get to it shortly...",
                parse_mode: telegramParseMode,
              }),
            },
          );
          return c.json({ ok: true, message: "Message queued" });
        }

        // Send typing indicator to show we're processing
        await sendChatAction(telegramBotToken, msg.chat.id, "typing");

        // Enqueue and start processing (non-blocking)
        enqueueMessage(threadId, msg.chat.id, msg.text);

        return c.json({ ok: true, message: "Message processing started" });
      }
    }

    return c.json({ ok: true, message: "Update received" });
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

    // Handle different GitHub events
    switch (githubEvent) {
      case "ping":
        return c.json({ ok: true, message: "Pong!" });

      case "pull_request":
      case "pull_request_review":
      case "pull_request_review_comment":
      case "issue_comment": {
        log.info(
          {
            action: payload.action,
            event: githubEvent,
            repository: payload.repository?.full_name,
          },
          "[webapp][github] PR event received",
        );

        // Run this asynchronously so we return 200 OK to GitHub immediately
        void (async () => {
          try {
            // Check if issue is a PR
            if (
              githubEvent === "issue_comment" &&
              !payload.issue?.pull_request
            ) {
              return;
            }

            // Extract context
            const [
              repoConfig,
              prNumber,
              branchName,
              githubLogin,
              prUrl,
              commentId,
              nodeId,
            ] = await extractPrContext(payload, githubEvent ?? "");

            if (!prNumber) {
              return;
            }

            const token =
              (await getGithubAppInstallationToken()) ||
              process.env.GITHUB_TOKEN?.trim() ||
              "";

            if (!token) {
              log.error(
                "[webapp][github] No GitHub token available to process PR event",
              );
              return;
            }

            const threadId = branchName
              ? await getThreadIdFromBranch(branchName)
              : null;
            if (threadId) {
              await storeGithubTokenInThread(threadId, token);
            }

            // Fetch comments
            const comments = await fetchPrCommentsSinceLastTag(
              repoConfig,
              prNumber,
              token,
            );

            if (comments.length === 0) {
              return;
            }

            // React to comment
            if (commentId) {
              await reactToGithubComment(
                repoConfig,
                commentId,
                githubEvent ?? "",
                token,
                prNumber,
                nodeId ?? undefined,
              );
            }

            // Build prompt
            const prompt = buildPrPrompt(comments, prUrl);

            // Get email mapping
            const email =
              getEmailForIdentity("github", githubLogin) ||
              "No email found in identity map";

            const finalMessage = `[System Context: Webhook event ${githubEvent} from GitHub user @${githubLogin} (Email: ${email})]\n\n${prompt}`;

            await runCodeagentTurn(
              finalMessage,
              undefined,
              undefined,
              "github",
            );
          } catch (err) {
            log.error(
              { err },
              "[webapp][github] Background PR processing failed",
            );
          }
        })();

        return c.json({ ok: true, message: "PR event processing started" });
      }

      case "issues": {
        const action = payload.action;
        const issue = payload.issue;
        const repository = payload.repository;

        log.info(
          {
            action,
            number: issue?.number,
            title: issue?.title,
          },
          "[webapp][github] Issue event",
        );

        if (action === "opened" && issue && repository) {
          const issueTitle = issue.title || "";
          const issueBody = issue.body || "";
          const repoOwner = repository.owner?.login;
          const repoName = repository.name;
          const issueNumber = issue.number;

          if (repoOwner && repoName && issueNumber) {
            // Process issue asynchronously
            void (async () => {
              try {
                const prompt = `New issue opened in ${repoOwner}/${repoName}#${issueNumber}:\nTitle: ${issueTitle}\n\n${issueBody}\n\nPlease analyze this issue and provide a helpful response.`;
                const reply = await runCodeagentTurn(
                  prompt,
                  undefined,
                  undefined,
                  "github",
                );

                const token =
                  getGithubToken() || (await getGithubAppInstallationToken());
                if (token) {
                  await postGithubComment(
                    { owner: repoOwner, name: repoName },
                    issueNumber,
                    reply,
                    token,
                  );
                  log.info(
                    { issueNumber },
                    "[webapp][github] Posted reply to issue",
                  );
                } else {
                  log.warn(
                    "[webapp][github] No GitHub token available to post issue comment",
                  );
                }
              } catch (err) {
                log.error(
                  { err },
                  "[webapp][github] Error processing issue event",
                );
              }
            })();
          }
        }
        return c.json({ ok: true, message: "Issue event received" });
      }

      case "push": {
        const repoName = payload.repository?.full_name || "unknown repository";
        const ref = payload.ref || "unknown ref";
        const commitsCount =
          payload.commits?.length || payload.push?.commits?.length || 0;

        log.info(
          {
            ref: payload.ref,
            commits: commitsCount,
          },
          "[webapp][github] Push event",
        );

        const input = `A push event was received on repository ${repoName} for ref ${ref} with ${commitsCount} commits.`;

        // Run the agent graph asynchronously so we don't block the webhook response
        runCodeagentTurn(input, undefined, undefined, "github").catch((err) => {
          log.error(
            { error: err },
            "[webapp][github] Error running agent on push event",
          );
        });

        return c.json({
          ok: true,
          message: "Push event received and processing started",
        });
      }

      default:
        log.info({ event: githubEvent }, "[webapp][github] Unhandled event");
        return c.json({ ok: true, message: `Event '${githubEvent}' received` });
    }
  } catch (error) {
    log.error({ error }, "[webapp] /webhook/github error");
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
  const { getThreadMetrics } = await import("./utils/telemetry");
  const { getTokenUsage } = await import("./utils/token-tracker");

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
  const { getTelemetryStatus } = await import("./utils/telemetry");
  const { getTokenStats, getAllThreadUsage } =
    await import("./utils/token-tracker");

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
