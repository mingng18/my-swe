import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { detectProvider } from "../model-factory";

describe("detectProvider", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LLM_PROVIDER;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns google if LLM_PROVIDER is explicitly google", () => {
    process.env.LLM_PROVIDER = "google";
    expect(detectProvider()).toBe("google");
  });

  it("returns openai if LLM_PROVIDER is explicitly openai", () => {
    process.env.LLM_PROVIDER = "openai";
    expect(detectProvider()).toBe("openai");
  });

  it("handles case-insensitivity and whitespace in LLM_PROVIDER", () => {
    process.env.LLM_PROVIDER = "  gOOgle  ";
    expect(detectProvider()).toBe("google");
  });

  it("returns google if GOOGLE_API_KEY is present and OPENAI_API_KEY is absent", () => {
    process.env.GOOGLE_API_KEY = "key";
    expect(detectProvider()).toBe("google");
  });

  it("returns openai if both GOOGLE_API_KEY and OPENAI_API_KEY are present", () => {
    process.env.GOOGLE_API_KEY = "key1";
    process.env.OPENAI_API_KEY = "key2";
    expect(detectProvider()).toBe("openai");
  });

  it("returns openai if no relevant environment variables are set", () => {
    expect(detectProvider()).toBe("openai");
  });
});
