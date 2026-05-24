import { createLogger } from "./utils/logger";
import { serve } from "bun";

import app from "./webapp";
import { initAgentProviderAtStartup } from "./harness";
import {
  loadTelegramBackoffConfig,
  loadTelegramConfig,
  validateStartupConfig,
} from "./utils/config";
import { runCodeagentTurn } from "./server";
import { getEmailForIdentity } from "./utils/identity";
import { isDuplicateMessage, formatTelegramMarkdownV2 } from "./utils/telegram";

// Memory system integration
import { getMemoryDaemon } from "./memory/daemon";

// Shared queue utility for Telegram message processing
import { generateThreadId, TelegramMessageQueue } from "./utils/telegram-queue";
import { setupGracefulShutdown } from "./utils/shutdown";

const logger = createLogger("index");

const PORT = Number.parseInt(process.env.PORT || "7860", 10);

setupGracefulShutdown();

// Telegram polling queue with identity enrichment
interface PollingMessage {
  enrichedText: string;
  chatId: number;
  telegramBotToken: string;
  userId?: string;
  parseMode: string;
}

const telegramQueue = new TelegramMessageQueue<PollingMessage>(async (threadId, msg) => {
  // Show typing indicator while processing
  try {
    await fetch(`https://api.telegram.org/bot${msg.telegramBotToken}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: msg.chatId, action: "typing" }),
    });
  } catch {
    // Typing indicator is optional
  }

  const reply = await runCodeagentTurn(msg.enrichedText, threadId, msg.userId, "telegram");

  // Format reply for Telegram MarkdownV2
  const formattedReply = msg.parseMode === "MarkdownV2"
    ? formatTelegramMarkdownV2(reply)
    : reply;

  await fetch(`https://api.telegram.org/bot${msg.telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: msg.chatId,
      text: formattedReply,
      parse_mode: msg.parseMode,
    }),
  });

  logger.info("[codeagent][telegram] reply sent");
});

async function handleTelegramMessage(msg: any, telegramBotToken: string, parseMode: string) {
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
  if (telegramQueue.isThreadActive(threadId)) {
    logger.info(
      { threadId, chatId: msg.chat.id },
      "[codeagent][telegram] thread busy, queuing message",
    );
    telegramQueue.enqueue(threadId, { enrichedText, chatId: msg.chat.id, telegramBotToken, userId, parseMode });
    // Send acknowledgment
    await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: msg.chat.id,
        text: "Message queued. I'll get to it shortly...",
        parse_mode: parseMode,
      }),
    });
    return;
  }

  // Enqueue and process
  telegramQueue.enqueue(threadId, { enrichedText, chatId: msg.chat.id, telegramBotToken, userId, parseMode });
}

// Telegram polling for local development
async function startTelegramPolling() {
  const { telegramBotToken, telegramParseMode } = loadTelegramConfig();
  const { baseDelayMs, maxDelayMs } = loadTelegramBackoffConfig();
  let offset = 0;
  let consecutiveErrors = 0;

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
            await handleTelegramMessage(update.message, telegramBotToken, telegramParseMode);
          }
        }
      }

      // Reset error counter on successful request
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors++;

      const isError = error instanceof Error;
      const errorMsg = isError ? error.message : String(error);
      const baseDelay = Math.min(
        baseDelayMs * Math.pow(2, consecutiveErrors - 1),
        maxDelayMs,
      );
      const jitter = 0.75 + Math.random() * 0.5;
      const delayMs = Math.floor(baseDelay * jitter);

      logger.error(
        {
          error: errorMsg,
          attempt: consecutiveErrors,
          delayMs,
        },
        "[codeagent][telegram] polling error - retrying with exponential backoff",
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
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
