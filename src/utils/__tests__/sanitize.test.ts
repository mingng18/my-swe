import { describe, expect, it } from "bun:test";
import {
  sanitizeString,
  sanitizeUserPrompt,
  sanitizeThreadId,
  sanitizeUserId,
  sanitizeBranchName,
  sanitizeCommitMessage,
  sanitizeUrl,
  sanitizeApiToken,
  parseJsonSafely,
} from "../sanitize";
import { z } from "zod";

describe("sanitizeString", () => {
  it("should return the same valid string", () => {
    const input = "Hello, World!";
    const result = sanitizeString(input);
    expect(result.value).toBe(input);
    expect(result.wasSanitized).toBe(false);
  });

  it("should throw for non-string input", () => {
    expect(() => sanitizeString(123)).toThrow(/Invalid input type/);
    expect(() => sanitizeString(null)).toThrow(/Invalid input type/);
  });

  it("should throw if input exceeds max length", () => {
    const input = "a".repeat(15);
    expect(() => sanitizeString(input, { maxLength: 10 })).toThrow(
      /Input too large/,
    );
  });

  it("should strip control characters by default but throw when found", () => {
    const input = "hello\x00world";
    expect(() => sanitizeString(input)).toThrow(
      /Input contains null byte or control characters/,
    );
  });

  it("should allow control characters if stripControl is false", () => {
    const input = "hello\x00world";
    const result = sanitizeString(input, { stripControl: false });
    expect(result.value).toBe(input);
  });

  it("should throw on dangerous patterns", () => {
    const dangerousInputs = [
      "${hello}",
      "{{world}}",
      "<script>alert(1)</script>",
      "javascript:alert(1)",
      "<a onload='alert(1)'>",
    ];

    for (const input of dangerousInputs) {
      expect(() => sanitizeString(input)).toThrow(
        /Input contains potentially dangerous pattern/,
      );
    }
  });

  it("should normalize unicode by default", () => {
    const unnormalized = "e\u0301";
    const result = sanitizeString(unnormalized);
    expect(result.value).toBe("\u00E9");
  });

  it("should skip unicode normalization if disabled", () => {
    const unnormalized = "e\u0301";
    const result = sanitizeString(unnormalized, { normalizeUnicode: false });
    expect(result.value).toBe(unnormalized);
  });

  it("should enforce allowed characters regex", () => {
    expect(() =>
      sanitizeString("hello!", { allowedChars: /^[a-z]+$/ }),
    ).toThrow(/Input contains characters not matching allowed pattern/);
    const result = sanitizeString("hello", { allowedChars: /^[a-z]+$/ });
    expect(result.value).toBe("hello");
  });

  it("should trim whitespace", () => {
    const result = sanitizeString("  hello world  ");
    expect(result.value).toBe("hello world");
    expect(result.wasSanitized).toBe(true);
  });

  it("should return correct sanitizedLength and originalLength", () => {
    const result = sanitizeString("  test  ");
    expect(result.originalLength).toBe(8);
    expect(result.sanitizedLength).toBe(4);
    expect(result.wasSanitized).toBe(true);
  });

  it("should include context in error messages", () => {
    expect(() => sanitizeString(123, { context: "testContext" })).toThrow(
      /\[testContext\] Invalid input type/,
    );
    expect(() =>
      sanitizeString("a".repeat(15), { maxLength: 10, context: "custom" }),
    ).toThrow(/\[custom\] Input too large/);
  });
});

describe("sanitizeUserPrompt", () => {
  it("should sanitize valid prompts", () => {
    expect(sanitizeUserPrompt("Please write a test")).toBe(
      "Please write a test",
    );
  });

  it("should throw on empty prompts", () => {
    expect(() => sanitizeUserPrompt("   ")).toThrow(
      "User prompt cannot be empty",
    );
  });
});

describe("sanitizeThreadId", () => {
  it("should sanitize valid thread IDs", () => {
    expect(sanitizeThreadId("thread_123-abc")).toBe("thread_123-abc");
  });

  it("should throw on invalid characters", () => {
    expect(() => sanitizeThreadId("thread@123")).toThrow(
      /Input contains characters not matching/,
    );
  });
});

describe("sanitizeUserId", () => {
  it("should sanitize user ID", () => {
    expect(sanitizeUserId("user-123")).toBe("user-123");
  });
});

describe("sanitizeBranchName", () => {
  it("should sanitize branch name", () => {
    expect(sanitizeBranchName("feature/new-button_1")).toBe(
      "feature/new-button_1",
    );
  });

  it("should throw on invalid characters", () => {
    expect(() => sanitizeBranchName("feature/new button")).toThrow(
      /Input contains characters not matching/,
    );
  });
});

describe("sanitizeCommitMessage", () => {
  it("should sanitize commit message", () => {
    expect(sanitizeCommitMessage("Fix bug")).toBe("Fix bug");
  });

  it("should throw on empty message", () => {
    expect(() => sanitizeCommitMessage("   ")).toThrow(
      "Commit message cannot be empty",
    );
  });

  it("should allow newlines", () => {
    expect(sanitizeCommitMessage("Fix bug\n\nDetails here")).toBe(
      "Fix bug\n\nDetails here",
    );
  });
});

describe("sanitizeUrl", () => {
  it("should sanitize http/https urls", () => {
    expect(sanitizeUrl("https://example.com")).toBe("https://example.com/");
    expect(sanitizeUrl("http://example.com/path?q=1")).toBe(
      "http://example.com/path?q=1",
    );
  });

  it("should throw on non-http/https protocols", () => {
    expect(() => sanitizeUrl("ftp://example.com")).toThrow(
      "URL protocol not allowed: ftp:",
    );
    expect(() => sanitizeUrl("javascript:alert(1)")).toThrow(
      /Input contains potentially dangerous pattern/,
    );
    expect(() => sanitizeUrl("data:text/html,<html>")).toThrow(
      "URL protocol not allowed: data:",
    );
    expect(() => sanitizeUrl("file:///etc/passwd")).toThrow(
      "URL protocol not allowed: file:",
    );
  });

  it("should throw on invalid URLs", () => {
    expect(() => sanitizeUrl("not_a_url")).toThrow(/Invalid URL/);
  });
});

describe("sanitizeApiToken", () => {
  it("should sanitize api token", () => {
    expect(sanitizeApiToken("token123")).toBe("token123");
  });

  it("should throw on empty token", () => {
    expect(() => sanitizeApiToken("   ")).toThrow("API token cannot be empty");
  });
});

describe("parseJsonSafely", () => {
  it("should parse valid JSON", () => {
    expect(parseJsonSafely<{ hello: string }>('{"hello": "world"}')).toEqual({
      hello: "world",
    });
    expect(parseJsonSafely<number[]>("[1, 2, 3]")).toEqual([1, 2, 3]);
  });

  it("should throw on size limits", () => {
    expect(() => parseJsonSafely('{"a": 1}', { maxSize: 5 })).toThrow(
      /JSON input exceeds maximum size/,
    );
  });

  it("should throw on invalid JSON", () => {
    expect(() => parseJsonSafely("{invalid}")).toThrow(/Invalid JSON/);
  });

  it("should throw when exceeding max depth", () => {
    const deepJson = '{"a": {"b": {"c": 1}}}';
    expect(() => parseJsonSafely(deepJson, { maxDepth: 2 })).toThrow(
      /JSON depth exceeds maximum/,
    );
  });

  it("should throw when array exceeds max depth", () => {
    const deepJsonArray = "[[[1]]]";
    expect(() => parseJsonSafely(deepJsonArray, { maxDepth: 2 })).toThrow(
      /JSON depth exceeds maximum/,
    );
  });

  it("should not throw when exactly at max depth", () => {
    const jsonObject = '{"a": {"b": 1}}'; // depth 2
    expect(() => parseJsonSafely(jsonObject, { maxDepth: 2 })).not.toThrow();

    const jsonArray = "[[1]]"; // depth 2
    expect(() => parseJsonSafely(jsonArray, { maxDepth: 2 })).not.toThrow();
  });

  it("should throw when mixed objects and arrays exceed max depth", () => {
    const mixedJson = '{"a": [{"b": {"c": 1}}]}'; // {"a": (1) [{"b": (2) {"c": (3) 1}}]} -> c is depth 4
    expect(() => parseJsonSafely(mixedJson, { maxDepth: 3 })).toThrow(
      /JSON depth exceeds maximum/,
    );
  });

  it("should block prototype pollution", () => {
    const polluted = '{"__proto__": {"polluted": true}}';
    expect(() => parseJsonSafely(polluted)).toThrow(
      /Prototype pollution detected/,
    );

    const constructed = '{"constructor": {"prototype": {"polluted": true}}}';
    expect(() => parseJsonSafely(constructed)).toThrow(
      /Prototype pollution detected/,
    );
  });

  it("should allow prototype properties if blockProto is false", () => {
    const polluted = '{"__proto__": {"polluted": true}}';
    const result = parseJsonSafely(polluted, { blockProto: false });
    expect(
      (result as { __proto__: { polluted: boolean } }).__proto__.polluted,
    ).toBe(true);
  });

  it("should validate using schema", () => {
    const TestSchema = z.object({
      name: z.string(),
      age: z.number(),
    });

    expect(
      parseJsonSafely('{"name": "Alice", "age": 30}', { schema: TestSchema }),
    ).toEqual({
      name: "Alice",
      age: 30,
    });

    expect(() =>
      parseJsonSafely('{"name": "Alice"}', { schema: TestSchema }),
    ).toThrow();
  });
});
