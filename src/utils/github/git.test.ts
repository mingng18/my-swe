import { describe, expect, test } from "bun:test";
import { sanitizeAuthUrl, sanitizeTokenFromString } from "./git";

describe("git", () => {
  describe("sanitizeAuthUrl", () => {
    test("replaces token with ***", () => {
      const url = "https://x-access-token:ghs_1234567890abcdef@github.com/owner/repo.git";
      const sanitized = sanitizeAuthUrl(url);
      expect(sanitized).toBe("https://***@github.com/owner/repo.git");
    });

    test("handles http URLs", () => {
      const url = "http://x-access-token:ghs_1234567890abcdef@github.com/owner/repo.git";
      const sanitized = sanitizeAuthUrl(url);
      expect(sanitized).toBe("http://***@github.com/owner/repo.git");
    });

    test("leaves URLs without token unchanged", () => {
      const url = "https://github.com/owner/repo.git";
      const sanitized = sanitizeAuthUrl(url);
      expect(sanitized).toBe("https://github.com/owner/repo.git");
    });

    test("leaves URLs with normal auth unchanged", () => {
      const url = "https://user:pass@github.com/owner/repo.git";
      const sanitized = sanitizeAuthUrl(url);
      expect(sanitized).toBe("https://user:pass@github.com/owner/repo.git");
    });
  });
});

describe("sanitizeTokenFromString", () => {
  test("replaces a single occurrence of the token", () => {
    const msg = "Error: Authentication failed for token my-secret-token.";
    const result = sanitizeTokenFromString(msg, "my-secret-token");
    expect(result).toBe("Error: Authentication failed for token ***.");
  });

  test("replaces multiple occurrences of the token", () => {
    const msg = "Token my-secret-token was used. my-secret-token is invalid.";
    const result = sanitizeTokenFromString(msg, "my-secret-token");
    expect(result).toBe("Token *** was used. *** is invalid.");
  });

  test("handles token at the very beginning of the string", () => {
    const msg = "my-secret-token caused an error";
    const result = sanitizeTokenFromString(msg, "my-secret-token");
    expect(result).toBe("*** caused an error");
  });

  test("handles token at the very end of the string", () => {
    const msg = "Failed due to my-secret-token";
    const result = sanitizeTokenFromString(msg, "my-secret-token");
    expect(result).toBe("Failed due to ***");
  });

  test("returns original message if token is empty", () => {
    const msg = "Some error message";
    const result = sanitizeTokenFromString(msg, "");
    expect(result).toBe("Some error message");
  });

  test("returns original message if token is not found", () => {
    const msg = "Some error message without the secret";
    const result = sanitizeTokenFromString(msg, "my-secret-token");
    expect(result).toBe("Some error message without the secret");
  });

  test("handles empty message", () => {
    const result = sanitizeTokenFromString("", "my-secret-token");
    expect(result).toBe("");
  });
});
