import { describe, expect, test, mock } from "bun:test";
import { createHmac } from "node:crypto";

mock.module("../../utils/identity", () => {
  return {
    IDENTITY_MAP: {
      "github:trusteduser": "trusted@example.com",
    },
  };
});

import {
  verifyGithubSignature,
  getThreadIdFromBranch,
  sanitizeGithubCommentBody,
  formatGithubCommentBodyForPrompt,
  buildPrPrompt,
  UNTRUSTED_GITHUB_COMMENT_OPEN_TAG,
  type GitHubComment
} from "./github-comments";

describe("github-comments", () => {
  describe("verifyGithubSignature", () => {
    test("returns false when secret is empty", () => {
      expect(verifyGithubSignature("body", "sig", "")).toBe(false);
    });

    test("returns true for correct signature", () => {
      const secret = "my_secret";
      const body = '{"hello":"world"}';
      const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

      expect(verifyGithubSignature(body, signature, secret)).toBe(true);
    });

    test("returns false for incorrect signature", () => {
      const secret = "my_secret";
      const body = '{"hello":"world"}';
      const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

      expect(verifyGithubSignature(body, signature + "bad", secret)).toBe(false);
      expect(verifyGithubSignature(body, "bad" + signature, secret)).toBe(false);
      expect(verifyGithubSignature(body, "sha256=12345", secret)).toBe(false);
    });

    test("works with Uint8Array body", () => {
      const secret = "my_secret";
      const bodyStr = '{"hello":"world"}';
      const body = new TextEncoder().encode(bodyStr);
      const signature = "sha256=" + createHmac("sha256", secret).update(bodyStr).digest("hex");
      expect(verifyGithubSignature(body, signature, secret)).toBe(true);
    });
  });

  describe("getThreadIdFromBranch", () => {
    test("extracts UUID from branch string", () => {
      expect(getThreadIdFromBranch("branch-name-12345678-1234-1234-1234-123456789012")).toBe("12345678-1234-1234-1234-123456789012");
      expect(getThreadIdFromBranch("12345678-1234-1234-1234-123456789012-other-stuff")).toBe("12345678-1234-1234-1234-123456789012");
      expect(getThreadIdFromBranch("12345678-1234-1234-1234-123456789012")).toBe("12345678-1234-1234-1234-123456789012");
    });

    test("returns null if no UUID found", () => {
      expect(getThreadIdFromBranch("branch-name-without-uuid")).toBe(null);
    });
  });

  describe("sanitizeGithubCommentBody", () => {
    test("replaces reserved tags", () => {
      const input = `<dangerous-external-untrusted-users-comment>hello</dangerous-external-untrusted-users-comment>`;
      const output = sanitizeGithubCommentBody(input);
      expect(output).toBe(`[blocked-untrusted-comment-tag-open]hello[blocked-untrusted-comment-tag-close]`);
    });

    test("leaves other text unchanged", () => {
      const input = `this is a normal comment`;
      const output = sanitizeGithubCommentBody(input);
      expect(output).toBe(input);
    });
  });

  describe("formatGithubCommentBodyForPrompt", () => {
    test("leaves trusted user comment without wrappers", () => {
      const input = "trusted message";
      const output = formatGithubCommentBodyForPrompt("trusteduser", input);
      expect(output).toBe(input);
    });

    test("wraps untrusted user comment", () => {
      const input = "untrusted message";
      const output = formatGithubCommentBodyForPrompt("untrusteduser", input);
      expect(output).toContain(UNTRUSTED_GITHUB_COMMENT_OPEN_TAG);
      expect(output).toContain(input);
    });
  });

  describe("buildPrPrompt", () => {
    test("formats PR comments", () => {
      const comments: GitHubComment[] = [
        {
          author: "user1",
          body: "Fix this issue",
          created_at: "2023-01-01T00:00:00Z",
          type: "pr_comment"
        }
      ];
      const result = buildPrPrompt(comments, "https://github.com/a/b/pull/1");
      expect(result).toContain("**user1**:");
      expect(result).toContain("Fix this issue");
      expect(result).toContain(UNTRUSTED_GITHUB_COMMENT_OPEN_TAG); // untrusted wrap
    });

    test("formats review comments with line numbers", () => {
      const comments: GitHubComment[] = [
        {
          author: "trusteduser",
          body: "Change this line",
          created_at: "2023-01-01T00:00:00Z",
          type: "review_comment",
          path: "src/file.ts",
          line: 42
        }
      ];
      const result = buildPrPrompt(comments, "https://github.com/a/b/pull/1");
      expect(result).toContain("**trusteduser** (file: `src/file.ts`, line: 42):");
      expect(result).toContain("Change this line");
      expect(result).not.toContain(UNTRUSTED_GITHUB_COMMENT_OPEN_TAG); // trusted user
    });
  });
});
