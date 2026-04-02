import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadLlmConfig } from "./config";

describe("loadLlmConfig", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("throws Error when OPENAI_API_KEY is missing", () => {
    delete process.env.OPENAI_API_KEY;
    process.env.MODEL = "gpt-4o";

    expect(() => loadLlmConfig()).toThrow("Missing OPENAI_API_KEY. Set it in .env (see .env.example).");
  });

  test("throws Error when MODEL is missing", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.MODEL;

    expect(() => loadLlmConfig()).toThrow("Missing MODEL. Set it in .env (see .env.example).");
  });

  test("throws Error when OPENAI_API_KEY is empty", () => {
    process.env.OPENAI_API_KEY = "  ";
    process.env.MODEL = "gpt-4o";

    expect(() => loadLlmConfig()).toThrow("Missing OPENAI_API_KEY. Set it in .env (see .env.example).");
  });

  test("throws Error when MODEL is empty", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.MODEL = "  ";

    expect(() => loadLlmConfig()).toThrow("Missing MODEL. Set it in .env (see .env.example).");
  });

  test("throws Error for partial fallback config (missing fallback API key)", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.MODEL = "gpt-4o";
    process.env.MODEL_FALLBACK = "gpt-3.5-turbo";
    delete process.env.OPENAI_API_KEY_FALLBACK;

    expect(() => loadLlmConfig()).toThrow("Fallback LLM config requires both OPENAI_API_KEY_FALLBACK and MODEL_FALLBACK when any fallback variable is set.");
  });

  test("throws Error for partial fallback config (missing fallback model)", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.MODEL = "gpt-4o";
    process.env.OPENAI_API_KEY_FALLBACK = "sk-fallback";
    delete process.env.MODEL_FALLBACK;

    expect(() => loadLlmConfig()).toThrow("Fallback LLM config requires both OPENAI_API_KEY_FALLBACK and MODEL_FALLBACK when any fallback variable is set.");
  });

  test("returns config correctly for happy path without fallback", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.MODEL = "gpt-4o";
    delete process.env.OPENAI_BASE_URL;

    const config = loadLlmConfig();
    expect(config).toEqual({
      openaiApiKey: "sk-test",
      model: "gpt-4o",
      openaiBaseUrl: "https://api.openai.com/v1",
      fallback: undefined,
    });
  });

  test("returns config correctly for happy path with custom base url", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.MODEL = "gpt-4o";
    process.env.OPENAI_BASE_URL = "https://custom.api/v1";

    const config = loadLlmConfig();
    expect(config.openaiBaseUrl).toBe("https://custom.api/v1");
  });

  test("returns config correctly for happy path with fallback", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.MODEL = "gpt-4o";
    process.env.OPENAI_API_KEY_FALLBACK = "sk-fallback";
    process.env.MODEL_FALLBACK = "gpt-3.5-turbo";
    delete process.env.OPENAI_BASE_URL_FALLBACK;

    const config = loadLlmConfig();
    expect(config).toEqual({
      openaiApiKey: "sk-test",
      model: "gpt-4o",
      openaiBaseUrl: "https://api.openai.com/v1",
      fallback: {
        openaiApiKey: "sk-fallback",
        model: "gpt-3.5-turbo",
        openaiBaseUrl: "https://api.openai.com/v1",
      },
    });
  });
});
