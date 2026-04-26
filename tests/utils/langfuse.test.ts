import { describe, it, expect } from "bun:test";
import { maskSensitiveData } from "../../src/utils/langfuse";

describe("maskSensitiveData", () => {
  it("should mask Bearer tokens", () => {
    const input = "Authorization: Bearer sk-1234567890abcdefghijklmnopqrstuvwxyz123456";
    const result = maskSensitiveData(input);
    expect(result).toContain("***REDACTED***");
    expect(result).not.toContain("sk-1234567890");
  });

  it("should mask OpenAI-style API keys", () => {
    const input = "api_key=sk-1234567890abcdefghijklmnopqrstuvwxyz123456";
    const result = maskSensitiveData(input);
    expect(result).toContain("***REDACTED***");
    expect(result).not.toContain("sk-1234567890");
  });

  it("should mask Langfuse public keys", () => {
    const input = "LANGFUSE_PUBLIC_KEY=pk-1234567890abcdefghijklmnopqrstuvwxyz123456";
    const result = maskSensitiveData(input);
    expect(result).toContain("***REDACTED***");
    expect(result).not.toContain("pk-1234567890");
  });

  it("should mask password fields", () => {
    const input = '{"password":"mySecretPassword123"}';
    const result = maskSensitiveData(input);
    expect(result).toContain("***REDACTED***");
    expect(result).not.toContain("mySecretPassword123");
  });

  it("should handle empty string", () => {
    const result = maskSensitiveData("");
    expect(result).toBe("");
  });

  it("should handle string with no sensitive data", () => {
    const input = "Hello, world!";
    const result = maskSensitiveData(input);
    expect(result).toBe("Hello, world!");
  });

  it("should mask multiple occurrences", () => {
    const input = "api_key=sk-1234567890abcdefghijklmnopqrstuvwxyz and token=xyz789uvw012mnopqrstuvwxyzabcdef";
    const result = maskSensitiveData(input);
    const redactedCount = (result.match(/\*\*\*REDACTED\*\*\*/g) || []).length;
    expect(redactedCount).toBeGreaterThanOrEqual(2);
  });
});
