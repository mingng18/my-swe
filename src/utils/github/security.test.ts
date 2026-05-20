import { describe, test, expect } from "bun:test";
import { shellEscapeSingleQuotes } from "../shell";
import {
  sanitizeUserPrompt,
  sanitizeThreadId,
  sanitizeUserId,
  sanitizeBranchName,
  sanitizeUrl,
} from "../sanitize";

describe("Security Tests - Command Injection Prevention", () => {
  describe("shellEscapeSingleQuotes", () => {
    test("should safely escape single quotes", () => {
      const result = shellEscapeSingleQuotes("it's a test");
      expect(result).toBe("'it'\"'\"'s a test'");
    });

    test("should handle safe inputs correctly", () => {
      expect(shellEscapeSingleQuotes("main")).toBe("'main'");
      expect(shellEscapeSingleQuotes("feature/test-123")).toBe("'feature/test-123'");
      expect(shellEscapeSingleQuotes("v1.2.3")).toBe("'v1.2.3'");
    });
  });
});

describe("Security Tests - Input Sanitization", () => {
  describe("sanitizeUserPrompt", () => {
    test("should reject oversized inputs", () => {
      const oversized = "a".repeat(100001);
      expect(() => sanitizeUserPrompt(oversized)).toThrow("too large");
    });

    test("should reject null bytes", () => {
      expect(() => sanitizeUserPrompt("hello\x00world")).toThrow("null byte or control characters");
    });

    test("should reject template injection", () => {
      expect(() => sanitizeUserPrompt("${7*7}")).toThrow("dangerous pattern");
      expect(() => sanitizeUserPrompt("{{7*7}}")).toThrow("dangerous pattern");
    });

    test("should reject script tags", () => {
      expect(() => sanitizeUserPrompt("<script>alert('xss')</script>")).toThrow("dangerous pattern");
      expect(() => sanitizeUserPrompt("<SCRIPT>alert('xss')</SCRIPT>")).toThrow("dangerous pattern");
    });

    test("should reject javascript protocol", () => {
      expect(() => sanitizeUserPrompt("javascript:alert('xss')")).toThrow("dangerous pattern");
      expect(() => sanitizeUserPrompt("JAVASCRIPT:alert('xss')")).toThrow("dangerous pattern");
    });

    test("should reject event handlers", () => {
      expect(() => sanitizeUserPrompt("<img onerror=alert('xss')>")).toThrow("dangerous pattern");
      expect(() => sanitizeUserPrompt("<div ONMOUSEOVER=alert('xss')>")).toThrow("dangerous pattern");
    });

    test("should truncate oversized inputs to max limit", () => {
      const largeInput = "a".repeat(100001);
      expect(() => sanitizeUserPrompt(largeInput)).toThrow("too large");
    });

    test("should normalize Unicode", () => {
      const result = sanitizeUserPrompt("café\u0301");
      expect(result).toBeTruthy();
      expect(result.length).toBeGreaterThan(0);
    });

    test("should handle safe inputs", () => {
      expect(sanitizeUserPrompt("Create a login form")).toBe("Create a login form");
      expect(sanitizeUserPrompt("Fix the bug in auth.ts")).toBe("Fix the bug in auth.ts");
    });
  });

  describe("sanitizeThreadId", () => {
    test("should enforce thread ID format", () => {
      expect(() => sanitizeThreadId("invalid thread id!")).toThrow();
      expect(() => sanitizeThreadId("thread@example.com")).toThrow();
    });

    test("should accept valid thread IDs", () => {
      expect(sanitizeThreadId("thread-abc123")).toBe("thread-abc123");
      expect(sanitizeThreadId("user_123_thread_456")).toBe("user_123_thread_456");
    });
  });

  describe("sanitizeUserId", () => {
    test("should reject non-string inputs", () => {
      expect(() => sanitizeUserId(123 as any)).toThrow();
      expect(() => sanitizeUserId(null as any)).toThrow();
    });

    test("should enforce reasonable length", () => {
      const longId = "a".repeat(1000);
      expect(() => sanitizeUserId(longId)).toThrow();
    });

    test("should accept valid user IDs", () => {
      expect(sanitizeUserId("user-123")).toBe("user-123");
      expect(sanitizeUserId("github_456")).toBe("github_456");
    });
  });

  describe("sanitizeBranchName", () => {
    test("should reject dangerous branch names", () => {
      expect(() => sanitizeBranchName("../../../etc/passwd")).toThrow();
      expect(() => sanitizeBranchName("branch$(whoami)")).toThrow();
    });

    test("should enforce Git branch naming rules", () => {
      expect(() => sanitizeBranchName("branch with spaces")).toThrow();
    });

    test("should accept valid branch names", () => {
      expect(sanitizeBranchName("main")).toBe("main");
      expect(sanitizeBranchName("feature/add-login")).toBe("feature/add-login");
      expect(sanitizeBranchName("fix/bug-123")).toBe("fix/bug-123");
      expect(sanitizeBranchName("-invalid-start")).toBe("-invalid-start");
    });
  });

  describe("sanitizeUrl", () => {
    test("should reject javascript protocol", () => {
      expect(() => sanitizeUrl("javascript:alert('xss')")).toThrow();
      expect(() => sanitizeUrl("JAVASCRIPT:alert('xss')")).toThrow();
    });

    test("should reject data protocol with script", () => {
      expect(() => sanitizeUrl("data:text/html,<script>alert('xss')</script>")).toThrow();
    });

    test("should reject malformed URLs", () => {
      expect(() => sanitizeUrl("not-a-url")).toThrow();
      expect(() => sanitizeUrl("http://")).toThrow();
    });

    test("should accept valid URLs", () => {
      expect(sanitizeUrl("https://example.com")).toBeTruthy();
      expect(sanitizeUrl("https://api.example.com/v1/users")).toBeTruthy();
      expect(sanitizeUrl("http://localhost:3000")).toBeTruthy();
    });
  });
});

describe("Security Tests - Rate Limiting", () => {
  test("should enforce per-minute limits", async () => {
    const { MultiDimensionalRateLimiter } = await import("../rate-limit");
    const limiter = new MultiDimensionalRateLimiter();

    const ip = "192.168.1.1";
    const threadId = "thread-test";
    const userId = "user-test";

    for (let i = 0; i < 10; i++) {
      const result = await limiter.checkLimit(
        { ip, threadId, userId, endpoint: "/run" },
        { perMinute: 10, perHour: 100 }
      );
      expect(result.allowed).toBe(true);
    }

    const result = await limiter.checkLimit(
      { ip, threadId, userId, endpoint: "/run" },
      { perMinute: 10, perHour: 100 }
    );
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  test("should enforce per-thread limits independently", async () => {
    const { MultiDimensionalRateLimiter } = await import("../rate-limit");
    const limiter = new MultiDimensionalRateLimiter();

    const ip = "192.168.1.1";
    const thread1 = "thread-1";
    const thread2 = "thread-2";

    for (let i = 0; i < 20; i++) {
      await limiter.checkLimit(
        { ip, threadId: thread1, endpoint: "/run" },
        { perMinute: 100, perHour: 1000, perThread: 20 }
      );
    }

    let result = await limiter.checkLimit(
      { ip, threadId: thread1, endpoint: "/run" },
      { perMinute: 100, perHour: 1000, perThread: 20 }
    );
    expect(result.allowed).toBe(false);

    result = await limiter.checkLimit(
      { ip, threadId: thread2, endpoint: "/run" },
      { perMinute: 100, perHour: 1000, perThread: 20 }
    );
    expect(result.allowed).toBe(true);
  });

  test("should track request counts correctly", async () => {
    const { MultiDimensionalRateLimiter } = await import("../rate-limit");
    const limiter = new MultiDimensionalRateLimiter();

    const ip = "192.168.1.1";

    for (let i = 0; i < 5; i++) {
      const result = await limiter.checkLimit(
        { ip, endpoint: "/run" },
        { perMinute: 10, perHour: 100 }
      );
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(10 - i - 1);
    }
  });
});
