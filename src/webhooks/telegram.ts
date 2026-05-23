import { createHash } from "crypto";
import { createLogger } from "../utils/logger";
import { runCodeagentTurn } from "../server";
import { loadTelegramConfig } from "../utils/config";
import { isDuplicateMessage, sendChatAction } from "../utils/telegram";

const log = createLogger("webhooks/telegram");

// Per-instance message queue for concurrent Telegram requests
interface QueueItem {
  chatId: number;
  text: string;
}
const messageQueue = new Map<string, QueueItem[]>();
const activeThreads = new Set<string>();

function generateThreadId(chatId: number): string {
  return createHash("sha256")
    .update(chatId.toString())
    .digest("hex")
    .substring(0, 16);
}

function enqueueMessage(
  threadId: string,
  chatId: number,
  text: string,
): void {
  if (!messageQueue.has(threadId)) {
    messageQueue.set(threadId, []);
  }
  messageQueue.get(threadId)!.push({ chatId, text });

  if (!activeThreads.has(threadId)) {
    processThreadQueue(threadId).catch((err) => {
      log.error({ err, threadId }, "[telegram] Error in processThreadQueue");
    });
  }
}

async function processThreadQueue(threadId: string): Promise<void> {
  if (activeThreads.has(threadId)) return;
  activeThreads.add(threadId);

  try {
    const { telegramBotToken, telegramParseMode } = loadTelegramConfig();
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
                parse_mode: telegramParseMode,
              }),
            },
          );
        }
      } catch (err) {
        log.error(
          { err, chatId: item.chatId },
          "[telegram] Error processing message",
        );
      }
    }
  } finally {
    activeThreads.delete(threadId);
  }

  // Clean up empty queue
  const remaining = messageQueue.get(threadId);
  if (!remaining || remaining.length === 0) {
    messageQueue.delete(threadId);
  }
}

/**
 * Handle a Telegram webhook update.
 *
 * Returns a result object describing the outcome.
 * The caller (webapp.ts) is responsible for constructing the HTTP response.
 */
export async function handleTelegramWebhook(
  update: any,
): Promise<{ ok: true; message: string }> {
  if ("message" in update) {
    const msg = update.message;
    if ("text" in msg && msg.text) {
      if (isDuplicateMessage(msg.chat.id, msg.message_id)) {
        return { ok: true, message: "Duplicate ignored" };
      }

      log.info(
        {
          chatId: msg.chat.id,
          messageId: msg.message_id,
          textLength: msg.text.length,
        },
        "[telegram] message",
      );

      const threadId = generateThreadId(msg.chat.id);
      const { telegramBotToken, telegramParseMode } = loadTelegramConfig();

      if (activeThreads.has(threadId)) {
        log.info(
          { threadId, chatId: msg.chat.id },
          "[telegram] thread busy, queuing message",
        );
        enqueueMessage(threadId, msg.chat.id, msg.text);
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
        return { ok: true, message: "Message queued" };
      }

      await sendChatAction(telegramBotToken, msg.chat.id, "typing");
      enqueueMessage(threadId, msg.chat.id, msg.text);
      return { ok: true, message: "Message processing started" };
    }
  }

  return { ok: true, message: "Update received" };
}