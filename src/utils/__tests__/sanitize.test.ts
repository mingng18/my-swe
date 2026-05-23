import { describe, it, expect } from "bun:test";
import { sanitizeUrl } from "../sanitize";

describe("Sanitize Utilities", () => {
  describe("sanitizeUrl", () => {
    it("should allow valid http and https URLs", () => {
      expect(sanitizeUrl("http://example.com")).toBe("http://example.com/");
      expect(sanitizeUrl("https://example.com/path?query=1")).toBe("https://example.com/path?query=1");
    });

    it("should throw an error for disallowed protocols", () => {
      expect(() => sanitizeUrl("ftp://example.com")).toThrow("URL protocol not allowed: ftp:");
      // Some patterns are blocked by string sanitization before URL parsing
      expect(() => sanitizeUrl("javascript:alert(1)")).toThrow("potentially dangerous pattern");
      expect(() => sanitizeUrl("data:text/html,<html>")).toThrow("URL protocol not allowed: data:");
      expect(() => sanitizeUrl("file:///etc/passwd")).toThrow("URL protocol not allowed: file:");
    });

    it("should throw an error for completely invalid URLs", () => {
      expect(() => sanitizeUrl("not-a-valid-url")).toThrow("Invalid URL:");
    });
  });
});
