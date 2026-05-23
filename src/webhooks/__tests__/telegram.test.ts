import { describe, it, expect, mock } from "bun:test";

mock.module("../../server", () => ({
  runCodeagentTurn: async (input: string) => `Mocked reply for: ${input}`,
}));

mock.module("../../utils/config", () => ({
  loadTelegramConfig: () => ({
    telegramBotToken: "mock-bot-token",
    telegramParseMode: "HTML",
  }),
}));

mock.module("../../utils/telegram", () => ({
  isDuplicateMessage: () => false,
  sendChatAction: async () => {},
}));

const { handleTelegramWebhook } = await import("../telegram");

describe("handleTelegramWebhook", () => {
  it("returns ok for non-message updates", async () => {
    const result = await handleTelegramWebhook({
      update_id: 12345,
      edited_message: { text: "edited" },
    });

    expect(result.ok).toBe(true);
    expect(result.message).toBe("Update received");
  });

  it("processes text messages", async () => {
    const result = await handleTelegramWebhook({
      update_id: 12345,
      message: {
        message_id: 1,
        chat: { id: 98765 },
        text: "hello world",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.message).toBe("Message processing started");
  });

  it("handles messages without text", async () => {
    const result = await handleTelegramWebhook({
      update_id: 12345,
      message: {
        message_id: 2,
        chat: { id: 98765 },
        photo: [{}],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.message).toBe("Update received");
  });
});