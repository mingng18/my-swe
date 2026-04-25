import { createHash } from "crypto";
import { createLogger } from "./utils/logger";
import { serve } from "bun";

import app from "./webapp";
import { initAgentProviderAtStartup } from "./harness";
import { loadTelegramConfig, validateStartupConfig } from "./utils/config";
import { runCodeagentTurn } from "./server";
import { getEmailForIdentity } from "./utils/identity";
import { isDuplicateMessage } from "./utils/telegram";

// Memory system integration
import { getMemoryDaemon } from "./memory/daemon";

// Message queue for concurrent requests
const messageQueue = new Map<string, string[]>();
const activeThreads = new Set<string>();

const logger = createLogger("index");

/**
 * Generate a deterministic thread ID from a Telegram chat ID.
 * This ensures each chat has its own conversation history.
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
function enqueueMessage(threadId: string, message: string): void {
  if (!messageQueue.has(threadId)) {
    messageQueue.set(threadId, []);
  }
  messageQueue.get(threadId)!.push(message);
}

/**
 * Process queued messages for a thread.
 */
async function processQueue(threadId: string): Promise<void> {
  const queue = messageQueue.get(threadId);
  if (!queue || queue.length === 0) return;

  const message = queue.shift()!;
  if (queue.length === 0) {
    messageQueue.delete(threadId);
  }

  await processMessage(threadId, message);

  // Continue processing if there are more messages
  if (messageQueue.has(threadId) && messageQueue.get(threadId)!.length > 0) {
    await processQueue(threadId);
  }
}

/**
 * Process a single message for a thread.
 */
async function processMessage(
  threadId: string,
  enrichedText: string,
  userId?: string,
): Promise<string> {
  activeThreads.add(threadId);
  try {
    const reply = await runCodeagentTurn(enrichedText, threadId, userId);
    return reply;
  } finally {
    activeThreads.delete(threadId);
  }
}

const PORT = Number.parseInt(process.env.PORT || "7860", 10);

async function handleTelegramMessage(msg: any, telegramBotToken: string) {
  if (!("text" in msg) || !msg.text) {
    return;
  }

  // Skip duplicate messages
  if (isDuplicateMessage(msg.chat.id, msg.message_id)) {
    return;
  }

  logger.info(
    {
      chatId: msg.chat.id,
      messageId: msg.message_id,
      text: msg.text,
    },
    "[codeagent][telegram] message",
  );

  // Extract the user identity
  const username = msg.from?.username || "unknown_user";
  const userId = msg.from?.id?.toString();
  const email =
    getEmailForIdentity("telegram", username) ||
    getEmailForIdentity("github", username) ||
    "No email found in identity map";

  // Enrich the text payload
  const enrichedText = `[System Context: Message sent by Telegram user @${username} (Email: ${email})]\n\n${msg.text}`;

  // Generate threadId from chat ID for per-chat conversation history
  const threadId = generateThreadId(msg.chat.id);

  // Check if thread is active, queue if busy
  if (isThreadActive(threadId)) {
    logger.info(
      { threadId, chatId: msg.chat.id },
      "[codeagent][telegram] thread busy, queuing message",
    );
    enqueueMessage(threadId, enrichedText);
    // Send acknowledgment
    await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: msg.chat.id,
        text: "Message queued. I'll get to it shortly...",
      }),
    });
    return;
  }

  // Process the message and send reply
  const reply = await processMessage(threadId, enrichedText, userId);

  // Send reply back to Telegram
  await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: msg.chat.id,
      text: reply,
    }),
  });

  logger.info("[codeagent][telegram] reply sent");

  // Process any queued messages
  if (messageQueue.has(threadId)) {
    void processQueue(threadId);
  }
}

// Telegram polling for local development
async function startTelegramPolling() {
  const { telegramBotToken } = loadTelegramConfig();
  let offset = 0;

  logger.info("[codeagent] starting Telegram polling mode (for local dev)");

  while (true) {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${telegramBotToken}/getUpdates?offset=${offset}&timeout=30`,
      );
      const data = (await response.json()) as any;

      if (data.ok && data.result?.length > 0) {
        for (const update of data.result) {
          offset = update.update_id + 1;

          logger.info(
            {
              updateId: update.update_id,
              type:
                Object.keys(update).find((k) => k !== "update_id") ?? "unknown",
            },
            "[codeagent][telegram] update received",
          );

          // Handle message updates
          if ("message" in update) {
            await handleTelegramMessage(update.message, telegramBotToken);
          }
        }
      }
    } catch (error) {
      logger.error({ error }, "[codeagent][telegram] polling error");
      // Wait before retrying to avoid rapid error loops
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

// Initialize DeepAgents server
try {
  validateStartupConfig();
  await initAgentProviderAtStartup();
} catch (err) {
  logger.error(
    // Use pino's conventional `err` key so stack/message serialize.
    { err },
    "[codeagent] Agent provider init failed — check OPENAI_BASE_URL, OPENAI_API_KEY, MODEL in .env",
  );
  process.exit(1);
}

// Initialize Memory Daemon if enabled
const memoryConsolidationEnabled =
  process.env.MEMORY_CONSOLIDATION_ENABLED === "true";

if (memoryConsolidationEnabled) {
  try {
    const consolidationIntervalHours = parseInt(
      process.env.MEMORY_CONSOLIDATION_INTERVAL_HOURS || "6",
      10,
    );
    const consolidationIntervalMs = consolidationIntervalHours * 60 * 60 * 1000;

    const memoryDaemon = getMemoryDaemon(
      undefined,
      undefined,
      undefined,
      consolidationIntervalMs,
    );

    memoryDaemon.start();

    logger.info(
      {
        interval: consolidationIntervalHours,
        intervalMs: consolidationIntervalMs,
      },
      "[codeagent] Memory consolidation daemon started",
    );
  } catch (err) {
    logger.error(
      { err },
      "[codeagent] Memory daemon initialization failed — continuing without memory consolidation",
    );
    // Don't exit - memory daemon is optional
  }
} else {
  logger.info("[codeagent] Memory consolidation daemon disabled");
}

logger.info("[codeagent] starting web server with polling mode…");
logger.info(`[codeagent] agent API available at http://127.0.0.1:${PORT}`);
logger.info(`[codeagent] telegram polling: enabled`);
logger.info(
  `[codeagent] github webhook: http://127.0.0.1:${PORT}/webhook/github`,
);

// Start the web server
serve({
  fetch: app.fetch,
  port: PORT,
});

logger.info(`[codeagent] web server listening on port ${PORT}`);

// Start Telegram polling (runs in background)
startTelegramPolling();
