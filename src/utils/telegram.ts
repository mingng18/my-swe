import { createLogger } from "./logger";

const logger = createLogger("telegram-utils");
const recentlyProcessedMessages = new Map<string, number>();
const MESSAGE_DEDUP_WINDOW_MS = 30000;

/** Valid Telegram chat actions for sendChatAction API */
export type TelegramChatAction =
  | "typing"
  | "upload_photo"
  | "record_video"
  | "upload_video"
  | "record_voice"
  | "upload_voice"
  | "upload_document"
  | "find_location"
  | "record_video_note"
  | "upload_video_note";

export function isDuplicateMessage(chatId: number, messageId: number): boolean {
  const key = `${chatId}:${messageId}`;
  const now = Date.now();

  for (const [msgKey, timestamp] of recentlyProcessedMessages.entries()) {
    if (now - timestamp > MESSAGE_DEDUP_WINDOW_MS) {
      recentlyProcessedMessages.delete(msgKey);
    }
  }

  if (recentlyProcessedMessages.has(key)) {
    logger.info({ chatId, messageId }, "Duplicate message detected, skipping");
    return true;
  }

  recentlyProcessedMessages.set(key, now);
  return false;
}

/**
 * Send a chat action to a Telegram chat to show activity status (e.g., "typing...").
 * This is useful for providing visual feedback while processing long-running requests.
 *
 * @param botToken - The Telegram bot token from @BotFather
 * @param chatId - The target chat ID to send the action to
 * @param action - The action to display (e.g., "typing", "upload_document")
 * @throws Error if the API request fails
 *
 * @example
 * ```ts
 * await sendChatAction(botToken, chatId, "typing");
 * await sendChatAction(botToken, chatId, "upload_document");
 * ```
 */
export async function sendChatAction(
  botToken: string,
  chatId: number,
  action: TelegramChatAction,
): Promise<void> {
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendChatAction`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        action: action,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Telegram API error (${response.status}): ${errorText}`,
      );
    }

    logger.debug({ chatId, action }, "Chat action sent successfully");
  } catch (error) {
    logger.error({ chatId, action, error }, "Failed to send chat action");
    throw error;
  }
}
