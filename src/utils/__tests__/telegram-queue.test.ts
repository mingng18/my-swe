import { describe, expect, test } from "bun:test";
import { generateThreadId } from "../telegram-queue";

describe("generateThreadId", () => {
  test("should return a 16-character string", () => {
    const threadId = generateThreadId(123456);
    expect(typeof threadId).toBe("string");
    expect(threadId.length).toBe(16);
  });

  test("should be deterministic for the same chat ID", () => {
    const id1 = generateThreadId(987654321);
    const id2 = generateThreadId(987654321);
    expect(id1).toBe(id2);
  });

  test("should generate different IDs for different chat IDs", () => {
    const id1 = generateThreadId(111111);
    const id2 = generateThreadId(222222);
    expect(id1).not.toBe(id2);
  });

  test("should handle negative chat IDs correctly", () => {
    const threadId = generateThreadId(-123456);
    expect(typeof threadId).toBe("string");
    expect(threadId.length).toBe(16);
    // Ensure it's deterministic
    expect(generateThreadId(-123456)).toBe(threadId);
  });

  test("should handle 0 as chat ID", () => {
    const threadId = generateThreadId(0);
    expect(typeof threadId).toBe("string");
    expect(threadId.length).toBe(16);
  });
});
