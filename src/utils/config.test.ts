import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadTelegramConfig } from "./config";

describe("loadTelegramConfig", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("should return token when TELEGRAM_BOT_TOKEN is set", () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    expect(loadTelegramConfig()).toEqual({ telegramBotToken: "test-token" });
  });

  test("should throw an error when TELEGRAM_BOT_TOKEN is missing", () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(() => loadTelegramConfig()).toThrow(
      "Missing TELEGRAM_BOT_TOKEN. Copy .env.example to .env and set your bot token from @BotFather."
    );
  });

  test("should throw an error when TELEGRAM_BOT_TOKEN is empty", () => {
    process.env.TELEGRAM_BOT_TOKEN = "";
    expect(() => loadTelegramConfig()).toThrow(
      "Missing TELEGRAM_BOT_TOKEN. Copy .env.example to .env and set your bot token from @BotFather."
    );
  });

  test("should throw an error when TELEGRAM_BOT_TOKEN is whitespace", () => {
    process.env.TELEGRAM_BOT_TOKEN = "   ";
    expect(() => loadTelegramConfig()).toThrow(
      "Missing TELEGRAM_BOT_TOKEN. Copy .env.example to .env and set your bot token from @BotFather."
    );
  });
});
