import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadLlmConfig } from "./config";

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
    expect(() => loadLlmConfig()).toThrow("Missing OPENAI_API_KEY. Set it in .env (see .env.example).");
  });

  it("throws if MODEL is missing", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.MODEL;
    expect(() => loadLlmConfig()).toThrow("Missing MODEL. Set it in .env (see .env.example).");
  });

  it("throws if fallback is triggered but OPENAI_API_KEY_FALLBACK is missing", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.MODEL = "gpt-4o";
    process.env.MODEL_FALLBACK = "gpt-4o-mini";
    delete process.env.OPENAI_API_KEY_FALLBACK;
    expect(() => loadLlmConfig()).toThrow("Fallback LLM config requires both OPENAI_API_KEY_FALLBACK and MODEL_FALLBACK when any fallback variable is set.");
  });

  it("throws if fallback is triggered but MODEL_FALLBACK is missing", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.MODEL = "gpt-4o";
    process.env.OPENAI_API_KEY_FALLBACK = "sk-fallback";
    delete process.env.MODEL_FALLBACK;
    expect(() => loadLlmConfig()).toThrow("Fallback LLM config requires both OPENAI_API_KEY_FALLBACK and MODEL_FALLBACK when any fallback variable is set.");
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
