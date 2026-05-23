import { describe, test, expect } from "bun:test";
import { sanitizeString } from "../sanitize";

describe("sanitizeString", () => {
  test("throws error when input contains control characters and stripControl is true", () => {
    // null byte
    expect(() => {
      sanitizeString("hello\x00world", { stripControl: true });
    }).toThrow("Input contains null byte or control characters");

    // escape character
    expect(() => {
      sanitizeString("hello\x1Bworld", { stripControl: true });
    }).toThrow("Input contains null byte or control characters");
  });

  test("does not throw for control characters when stripControl is false", () => {
    const result = sanitizeString("hello\x00world", { stripControl: false });
    expect(result.value).toBe("hello\x00world");
    expect(result.wasSanitized).toBe(false);
  });

  test("allows valid strings without control characters", () => {
    const result = sanitizeString("hello world", { stripControl: true });
    expect(result.value).toBe("hello world");
    expect(result.wasSanitized).toBe(false);
  });

  test("trims whitespace from valid strings", () => {
    const result = sanitizeString("  hello world  ", { stripControl: true });
    expect(result.value).toBe("hello world");
    expect(result.wasSanitized).toBe(true);
    expect(result.originalLength).toBe(15);
    expect(result.sanitizedLength).toBe(11);
  });
});
