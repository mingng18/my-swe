import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";

// Capture the REAL telegram module BEFORE mocking. Bun's mock.module replaces
// the module process-wide; a partial factory that only exposes
// isDuplicateMessage + sendChatAction strips every other named export AND
// overrides sendChatAction to a noop, which breaks the sibling
// src/utils/__tests__/telegram.test.ts (it asserts the REAL sendChatAction
// calls fetch). Spread the real module and override ONLY isDuplicateMessage
// (a function this file needs to control). sendChatAction is handled with a
// per-test spyOn on the real module (auto-restored), NOT a process-wide
// mock.module override, so the sibling telegram test always sees the real
// sendChatAction. (Pattern from commits ca85e58/efdf23c.)
import * as realTelegram from "../../utils/telegram";

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
  ...realTelegram,
  isDuplicateMessage: () => false,
}));

// Stub sendChatAction per-test (auto-restored by Bun after each test) so
// handleTelegramWebhook does not reach the Telegram API, without replacing the
// export process-wide for sibling files.
beforeEach(() => {
  spyOn(realTelegram, "sendChatAction").mockResolvedValue(undefined as any);
});

afterEach(() => {
  mock.restore();
});

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