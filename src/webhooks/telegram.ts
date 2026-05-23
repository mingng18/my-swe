import { createLogger } from "../utils/logger";
import { runCodeagentTurn } from "../server";
import { loadTelegramConfig } from "../utils/config";
import { isDuplicateMessage, sendChatAction } from "../utils/telegram";
import { generateThreadId, TelegramMessageQueue } from "../utils/telegram-queue";

const log = createLogger("webhooks/telegram");

interface QueueItem {
  chatId: number;
  text: string;
}

const queue = new TelegramMessageQueue<QueueItem>(async (threadId, item) => {
  const { telegramBotToken, telegramParseMode } = loadTelegramConfig();
  const reply = await runCodeagentTurn(item.text, threadId, undefined, "telegram");

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
});

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

      if (queue.isThreadActive(threadId)) {
        log.info(
          { threadId, chatId: msg.chat.id },
          "[telegram] thread busy, queuing message",
        );
        queue.enqueue(threadId, { chatId: msg.chat.id, text: msg.text });
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
      queue.enqueue(threadId, { chatId: msg.chat.id, text: msg.text });
      return { ok: true, message: "Message processing started" };
    }
  }

  return { ok: true, message: "Update received" };
}
