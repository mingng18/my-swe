import { createLogger } from "./logger";

const logger = createLogger("telegram-utils");
const recentlyProcessedMessages = new Map<string, number>();
const MESSAGE_DEDUP_WINDOW_MS = 30000;

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
