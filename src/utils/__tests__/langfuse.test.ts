import { describe, it, expect } from "bun:test";
import { maskSensitiveData } from "../langfuse";

describe("maskSensitiveData", () => {
  it("should handle empty strings and falsy values safely", () => {
    expect(maskSensitiveData("")).toBe("");
    // TypeScript ensures it takes a string, but we test falsy coercion just in case
    expect(maskSensitiveData(null as any)).toBeNull();
    expect(maskSensitiveData(undefined as any)).toBeUndefined();
  });

  it("should return safe text unmodified", () => {
    const text = "This is a normal log message with no sensitive data.";
    expect(maskSensitiveData(text)).toBe(text);
  });

  it("should mask Bearer tokens", () => {
    const text = "Authorization: Bearer my-secret-token-123+abc/def~ghi";
    expect(maskSensitiveData(text)).toBe("Authorization: ***REDACTED***");
  });

  it("should mask OpenAI-style API keys (sk-)", () => {
    const text = "Using key sk-1234567890abcdef1234567890abcdef for request";
    expect(maskSensitiveData(text)).toBe("Using key ***REDACTED*** for request");
  });

  it("should mask Langfuse public keys (pk-)", () => {
    const text = "Connecting with pk-1234567890abcdef1234567890abcdef";
    expect(maskSensitiveData(text)).toBe("Connecting with ***REDACTED***");
  });

  it("should mask generic api_key patterns", () => {
    const text1 = '{"api_key": "12345678901234567890"}';
    expect(maskSensitiveData(text1)).toBe('{"***REDACTED***"}');

    const text2 = "api-key=12345678901234567890";
    expect(maskSensitiveData(text2)).toBe("***REDACTED***");

    const text3 = "apiKey: 12345678901234567890";
    expect(maskSensitiveData(text3)).toBe("***REDACTED***");
  });

  it("should mask generic token patterns", () => {
    const text1 = '{"token": "12345678901234567890"}';
    expect(maskSensitiveData(text1)).toBe('{"***REDACTED***"}');

    const text2 = "token=12345678901234567890";
    expect(maskSensitiveData(text2)).toBe("***REDACTED***");
  });

  it("should mask password fields", () => {
    const text1 = '{"password": "mysecretpassword"}';
    expect(maskSensitiveData(text1)).toBe('{"***REDACTED***"}');

    const text2 = "password=mysecretpassword";
    expect(maskSensitiveData(text2)).toBe("***REDACTED***");
  });

  it("should mask multiple instances in the same string", () => {
    const text = "Bearer secret-token-1 and Bearer secret-token-2";
    expect(maskSensitiveData(text)).toBe("***REDACTED*** and ***REDACTED***");
  });

  it("should mask different types of sensitive data in the same string", () => {
    const text = "Connecting with pk-1234567890abcdef1234567890abcdef using key sk-1234567890abcdef1234567890abcdef";
    expect(maskSensitiveData(text)).toBe("Connecting with ***REDACTED*** using key ***REDACTED***");
  });
});