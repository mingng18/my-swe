import { createLogger } from "./utils/logger";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as httpLogger } from "hono/logger";

import { runCodeagentTurn } from "./server";
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
app.use("*", httpLogger());
app.use(
  "*",
  cors({
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
    allowMethods: ["POST", "GET", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

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
    const { input } = await c.req.json();

    if (typeof input !== "string" || !input.trim()) {
      return c.json(
        { error: "Invalid input: 'input' must be a non-empty string" },
        400,
      );
    }

    const out = await runCodeagentTurn(input);

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

    const out = await runCodeagentTurn(input);

    return c.json({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: body.model || "codeagent",
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
    const { telegramBotToken } = loadTelegramConfig();

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
        log.info(
          {
            chatId: msg.chat.id,
            messageId: msg.message_id,
            textLength: msg.text.length,
          },
          "[webapp][telegram] message",
        );

        // Run the agent graph
        const reply = await runCodeagentTurn(msg.text);

        // Send reply back to Telegram
        await fetch(
          `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: msg.chat.id,
              text: reply,
            }),
          },
        );

        return c.json({ ok: true, message: "Message processed" });
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

            await runCodeagentTurn(finalMessage);
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
                const reply = await runCodeagentTurn(prompt);

                const token = getGithubToken() || (await getGithubAppInstallationToken());
                if (token) {
                  await postGithubComment(
                    { owner: repoOwner, name: repoName },
                    issueNumber,
                    reply,
                    token
                  );
                  log.info({ issueNumber }, "[webapp][github] Posted reply to issue");
                } else {
                  log.warn("[webapp][github] No GitHub token available to post issue comment");
                }
              } catch (err) {
                log.error({ err }, "[webapp][github] Error processing issue event");
              }
            })();
          }
        }
        return c.json({ ok: true, message: "Issue event received" });
      }

      case "push": {
        const repoName = payload.repository?.full_name || "unknown repository";
        const ref = payload.ref || "unknown ref";
        const commitsCount = payload.commits?.length || payload.push?.commits?.length || 0;

        log.info(
          {
            ref: payload.ref,
            commits: commitsCount,
          },
          "[webapp][github] Push event",
        );

        const input = `A push event was received on repository ${repoName} for ref ${ref} with ${commitsCount} commits.`;

        // Run the agent graph asynchronously so we don't block the webhook response
        runCodeagentTurn(input).catch((err) => {
          log.error({ error: err }, "[webapp][github] Error running agent on push event");
        });

        return c.json({ ok: true, message: "Push event received and processing started" });
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

export default app;
