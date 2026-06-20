import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  loadLlmConfig,
  loadTelegramConfig,
  isArchitectEditorRoutingEnabled,
  loadArchitectEditorConfig,
  getRoleModelConfig,
  loadModelConfig,
} from "../config";

describe("loadLlmConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws if OPENAI_API_KEY is missing", () => {
    delete process.env.OPENAI_API_KEY;
    process.env.MODEL = "gpt-4o";
    expect(() => loadLlmConfig()).toThrow(
      "Missing OPENAI_API_KEY. Set it in .env (see .env.example).",
    );
  });

  it("throws if MODEL is missing", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.MODEL;
    expect(() => loadLlmConfig()).toThrow(
      "Missing MODEL. Set it in .env (see .env.example).",
    );
  });

  it("throws if fallback is triggered but OPENAI_API_KEY_FALLBACK is missing", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.MODEL = "gpt-4o";
    process.env.MODEL_FALLBACK = "gpt-4o-mini";
    delete process.env.OPENAI_API_KEY_FALLBACK;
    expect(() => loadLlmConfig()).toThrow(
      "Fallback LLM config requires both OPENAI_API_KEY_FALLBACK and MODEL_FALLBACK when any fallback variable is set.",
    );
  });

  it("throws if fallback is triggered but MODEL_FALLBACK is missing", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.MODEL = "gpt-4o";
    process.env.OPENAI_API_KEY_FALLBACK = "sk-fallback";
    delete process.env.MODEL_FALLBACK;
    expect(() => loadLlmConfig()).toThrow(
      "Fallback LLM config requires both OPENAI_API_KEY_FALLBACK and MODEL_FALLBACK when any fallback variable is set.",
    );
  });

  it("returns config when required environment variables are set", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.MODEL = "gpt-4o";
    delete process.env.OPENAI_BASE_URL;

    const config = loadLlmConfig();
    expect(config.openaiApiKey).toBe("sk-test");
    expect(config.model).toBe("gpt-4o");
    expect(config.openaiBaseUrl).toBe("https://api.openai.com/v1");
    expect(config.fallback).toBeUndefined();
  });

  it("returns config with fallback when fallback environment variables are set", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.MODEL = "gpt-4o";
    process.env.OPENAI_API_KEY_FALLBACK = "sk-fallback";
    process.env.MODEL_FALLBACK = "gpt-4o-mini";

    const config = loadLlmConfig();
    expect(config.fallback?.openaiApiKey).toBe("sk-fallback");
    expect(config.fallback?.model).toBe("gpt-4o-mini");
  });
});

describe("loadTelegramConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws if TELEGRAM_BOT_TOKEN is missing", () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(() => loadTelegramConfig()).toThrow(
      "Missing TELEGRAM_BOT_TOKEN. Copy .env.example to .env and set your bot token from @BotFather.",
    );
  });

  it("throws if TELEGRAM_BOT_TOKEN is only whitespace", () => {
    process.env.TELEGRAM_BOT_TOKEN = "   \n ";
    expect(() => loadTelegramConfig()).toThrow(
      "Missing TELEGRAM_BOT_TOKEN. Copy .env.example to .env and set your bot token from @BotFather.",
    );
  });

  it("returns config when TELEGRAM_BOT_TOKEN is set", () => {
    process.env.TELEGRAM_BOT_TOKEN = "12345:abcdef";
    delete process.env.TELEGRAM_ADMIN_CHAT_ID;

    const config = loadTelegramConfig();
    expect(config.telegramBotToken).toBe("12345:abcdef");
    expect(config.telegramAdminChatId).toBeUndefined();
  });

  it("returns config with admin chat id when TELEGRAM_ADMIN_CHAT_ID is set", () => {
    process.env.TELEGRAM_BOT_TOKEN = "12345:abcdef  ";
    process.env.TELEGRAM_ADMIN_CHAT_ID = "  987654321 ";

    const config = loadTelegramConfig();
    expect(config.telegramBotToken).toBe("12345:abcdef");
    expect(config.telegramAdminChatId).toBe("987654321");
  });
});

describe("Architect/Editor model routing (#497)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.MODEL = "gpt-4o";
    delete process.env.OPENAI_BASE_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("isArchitectEditorRoutingEnabled", () => {
    it("is disabled when neither ARCHITECT_MODEL nor EDITOR_MODEL is set", () => {
      delete process.env.ARCHITECT_MODEL;
      delete process.env.EDITOR_MODEL;
      expect(isArchitectEditorRoutingEnabled()).toBe(false);
    });

    it("is disabled when only ARCHITECT_MODEL is set", () => {
      process.env.ARCHITECT_MODEL = "gpt-4o";
      delete process.env.EDITOR_MODEL;
      expect(isArchitectEditorRoutingEnabled()).toBe(false);
    });

    it("is disabled when only EDITOR_MODEL is set", () => {
      delete process.env.ARCHITECT_MODEL;
      process.env.EDITOR_MODEL = "gpt-4o-mini";
      expect(isArchitectEditorRoutingEnabled()).toBe(false);
    });

    it("is enabled only when BOTH are set", () => {
      process.env.ARCHITECT_MODEL = "gpt-4o";
      process.env.EDITOR_MODEL = "gpt-4o-mini";
      expect(isArchitectEditorRoutingEnabled()).toBe(true);
    });

    it("treats whitespace-only values as unset", () => {
      process.env.ARCHITECT_MODEL = "   ";
      process.env.EDITOR_MODEL = "gpt-4o-mini";
      expect(isArchitectEditorRoutingEnabled()).toBe(false);
    });
  });

  describe("loadArchitectEditorConfig", () => {
    it("falls back to single MODEL config (no role) when disabled", () => {
      delete process.env.ARCHITECT_MODEL;
      delete process.env.EDITOR_MODEL;

      const ae = loadArchitectEditorConfig();
      expect(ae.enabled).toBe(false);
      // Both roles collapse to the single MODEL config without a role tag.
      expect(ae.architect.model).toBe("gpt-4o");
      expect(ae.editor.model).toBe("gpt-4o");
      expect(ae.architect.role).toBeUndefined();
      expect(ae.editor.role).toBeUndefined();
    });

    it("returns role-tagged configs when enabled", () => {
      process.env.ARCHITECT_MODEL = "claude-opus";
      process.env.EDITOR_MODEL = "claude-haiku";

      const ae = loadArchitectEditorConfig();
      expect(ae.enabled).toBe(true);
      expect(ae.architect.model).toBe("claude-opus");
      expect(ae.architect.role).toBe("architect");
      expect(ae.editor.model).toBe("claude-haiku");
      expect(ae.editor.role).toBe("editor");
    });

    it("reuses provider/key/base URL from the primary LLM config", () => {
      process.env.OPENAI_BASE_URL = "https://openrouter.ai/api/v1";
      process.env.ARCHITECT_MODEL = "strong-model";
      process.env.EDITOR_MODEL = "fast-model";

      const ae = loadArchitectEditorConfig();
      expect(ae.architect.openaiBaseUrl).toBe("https://openrouter.ai/api/v1");
      expect(ae.editor.openaiBaseUrl).toBe("https://openrouter.ai/api/v1");
      expect(ae.architect.openaiApiKey).toBe("sk-test");
      expect(ae.editor.openaiApiKey).toBe("sk-test");
    });
  });

  describe("getRoleModelConfig", () => {
    it("returns single MODEL config (identical to loadModelConfig) when disabled", () => {
      delete process.env.ARCHITECT_MODEL;
      delete process.env.EDITOR_MODEL;

      const byRole = getRoleModelConfig("editor");
      const single = loadModelConfig();
      // Default path must be byte-for-byte equivalent to today's behavior.
      expect(byRole).toEqual(single);
      expect(byRole.role).toBeUndefined();
    });

    it("returns the role-specific config when enabled", () => {
      process.env.ARCHITECT_MODEL = "architect-strong";
      process.env.EDITOR_MODEL = "editor-fast";

      expect(getRoleModelConfig("architect").model).toBe("architect-strong");
      expect(getRoleModelConfig("architect").role).toBe("architect");
      expect(getRoleModelConfig("editor").model).toBe("editor-fast");
      expect(getRoleModelConfig("editor").role).toBe("editor");
    });
  });
});
