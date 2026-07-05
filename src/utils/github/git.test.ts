import { describe, expect, test } from "bun:test";
import { sanitizeAuthUrl } from "./git";

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
