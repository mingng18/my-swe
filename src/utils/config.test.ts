import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadTelegramConfig } from "./config";

describe("loadTelegramConfig", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Cache the original environment
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore the original environment
    process.env = originalEnv;
  });

  test("should return token when TELEGRAM_BOT_TOKEN is set", () => {
    process.env.TELEGRAM_BOT_TOKEN = "fake_token";
    const config = loadTelegramConfig();
    expect(config.telegramBotToken).toBe("fake_token");
  });

  test("should throw an error when TELEGRAM_BOT_TOKEN is missing", () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(() => loadTelegramConfig()).toThrow("Missing TELEGRAM_BOT_TOKEN");
  });

  test("should throw an error when TELEGRAM_BOT_TOKEN is empty string", () => {
    process.env.TELEGRAM_BOT_TOKEN = "   ";
    expect(() => loadTelegramConfig()).toThrow("Missing TELEGRAM_BOT_TOKEN");
  });
});
