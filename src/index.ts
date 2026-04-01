import { createLogger } from "./utils/logger";
import { serve } from "bun";

import app from "./webapp";
import { initAgentProviderAtStartup } from "./harness";
import { loadTelegramConfig, validateStartupConfig } from "./utils/config";
import { runCodeagentTurn } from "./server";
import { getEmailForIdentity } from "./utils/identity";

const logger = createLogger("index");

const PORT = Number.parseInt(process.env.PORT || "7860", 10);

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
            const msg = update.message;
            if ("text" in msg && msg.text) {
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
              const email =
                getEmailForIdentity("telegram", username) ||
                getEmailForIdentity("github", username) ||
                "No email found in identity map";

              // Enrich the text payload
              const enrichedText = `[System Context: Message sent by Telegram user @${username} (Email: ${email})]\n\n${msg.text}`;

              // Run the agent graph
              const reply = await runCodeagentTurn(enrichedText);

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

              logger.info("[codeagent][telegram] reply sent");
            }
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
