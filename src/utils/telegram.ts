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

/**
 * Format a string as a code block for Telegram MarkdownV2.
 *
 * Wraps the provided code in triple backticks with proper formatting.
 *
 * @param code - The code to format
 * @returns Code wrapped in triple backticks
 *
 * @example
 * ```ts
 * formatCodeBlock('console.log("test")')
 * // Returns: "```\nconsole.log(\"test\")\n```"
 * ```
 */
export function formatCodeBlock(code: string): string {
  if (!code) {
    return "";
  }

  // Remove leading/trailing whitespace and wrap in code block markers
  const trimmedCode = code.trim();
  return `\`\`\`\n${trimmedCode}\n\`\`\``;
}

/**
 * Escape a string for use in Telegram MarkdownV2 format.
 *
 * This function escapes special characters that have meaning in MarkdownV2,
 * while preserving intentional markdown syntax (bold, italic, code, links, etc.).
 *
 * @param text - The text to format
 * @returns Text with special characters properly escaped for MarkdownV2
 *
 * @example
 * ```ts
 * formatTelegramMarkdownV2("*bold* text")
 * // Returns: "*bold* text" (markdown preserved)
 *
 * formatTelegramMarkdownV2("Check value: 5.5!")
 * // Returns: "Check value: 5\\.5\\!" (special chars escaped)
 * ```
 */
export function formatTelegramMarkdownV2(text: string): string {
  if (!text) {
    return "";
  }

  // Special characters in Telegram MarkdownV2 that need escaping
  const specialChars = [
    "_",
    "*",
    "[",
    "]",
    "(",
    ")",
    "~",
    "`",
    ">",
    "#",
    "+",
    "-",
    "=",
    "|",
    "{",
    "}",
    ".",
    "!",
  ];

  // Build regex pattern for all special chars
  const escapePattern = new RegExp(
    `([${specialChars.map((c) => `\\${c}`).join("")}])`,
    "g",
  );

  let result = "";
  let i = 0;

  while (i < text.length) {
    // Check for markdown patterns to preserve
    const remaining = text.slice(i);

    // Bold: *text* or __text__
    const boldMatch = remaining.match(/^\*([^*\n]+)\*/);
    const boldMatch2 = remaining.match(/^__([^_\n]+)__/);
    if (boldMatch) {
      const content = formatTelegramMarkdownV2(boldMatch[1]); // Recursively format content
      result += `*${content}*`;
      i += boldMatch[0].length;
      continue;
    }
    if (boldMatch2) {
      const content = formatTelegramMarkdownV2(boldMatch2[1]); // Recursively format content
      result += `__${content}__`;
      i += boldMatch2[0].length;
      continue;
    }

    // Italic: _text_ (but not already matched as bold)
    const italicMatch = remaining.match(/^_([^_\n]+)_/);
    if (italicMatch) {
      const content = formatTelegramMarkdownV2(italicMatch[1]); // Recursively format content
      result += `_${content}_`;
      i += italicMatch[0].length;
      continue;
    }

    // Code: `text`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      result += codeMatch[0]; // Preserve code blocks as-is
      i += codeMatch[0].length;
      continue;
    }

    // Pre: ```text```
    const preMatch = remaining.match(/^```([\s\S]*?)```/);
    if (preMatch) {
      result += preMatch[0]; // Preserve pre blocks as-is
      i += preMatch[0].length;
      continue;
    }

    // URL: [text](url)
    const urlMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (urlMatch) {
      const linkText = formatTelegramMarkdownV2(urlMatch[1]); // Recursively format link text
      result += `[${linkText}](${urlMatch[2]})`;
      i += urlMatch[0].length;
      continue;
    }

    // Escape special characters
    if (specialChars.includes(text[i])) {
      result += `\\${text[i]}`;
      i++;
    } else {
      result += text[i];
      i++;
    }
  }

  return result;
}
