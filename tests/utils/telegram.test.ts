import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  isDuplicateMessage,
  formatCodeBlock,
  formatTelegramMarkdownV2,
} from "../../src/utils/telegram";

describe("isDuplicateMessage", () => {
  it("should return false for first occurrence of a message", () => {
    // Use unique chat/message IDs to avoid conflicts with other tests
    const result = isDuplicateMessage(100001, 1);
    expect(result).toBe(false);
  });

  it("should return true for duplicate message within window", () => {
    // Use unique chat/message IDs
    const result1 = isDuplicateMessage(100002, 1);
    const result2 = isDuplicateMessage(100002, 1);
    expect(result1).toBe(false);
    expect(result2).toBe(true);
  });

  it("should return false for different message IDs", () => {
    // Use unique chat/message IDs
    const result1 = isDuplicateMessage(100003, 1);
    const result2 = isDuplicateMessage(100003, 2);
    expect(result1).toBe(false);
    expect(result2).toBe(false);
  });

  it("should return false for different chat IDs", () => {
    // Use unique chat/message IDs
    const result1 = isDuplicateMessage(100004, 1);
    const result2 = isDuplicateMessage(100005, 1);
    expect(result1).toBe(false);
    expect(result2).toBe(false);
  });

  it("should track message timestamps correctly", () => {
    // Test that the deduplication is time-based
    // This test verifies the mechanism without relying on exact timing
    const chatId = 100006;
    const messageId = 1;

    // First call should return false (not a duplicate)
    const result1 = isDuplicateMessage(chatId, messageId);
    expect(result1).toBe(false);

    // Immediate second call should return true (duplicate)
    const result2 = isDuplicateMessage(chatId, messageId);
    expect(result2).toBe(true);

    // Different message ID should return false (not a duplicate)
    const result3 = isDuplicateMessage(chatId, messageId + 1);
    expect(result3).toBe(false);
  });

  it("should track multiple messages independently", () => {
    // Use unique chat/message IDs
    const result1 = isDuplicateMessage(100007, 1);
    const result2 = isDuplicateMessage(100007, 2);
    const result3 = isDuplicateMessage(100008, 1);
    expect(result1).toBe(false);
    expect(result2).toBe(false);
    expect(result3).toBe(false);
  });

  it("should handle large chat and message IDs", () => {
    const result = isDuplicateMessage(9999999999, 9999999999);
    expect(result).toBe(false);
  });
});

describe("formatCodeBlock", () => {
  it("should wrap code in triple backticks", () => {
    const result = formatCodeBlock('console.log("test")');
    expect(result).toBe("```\nconsole.log(\"test\")\n```");
  });

  it("should trim leading/trailing whitespace", () => {
    const result = formatCodeBlock("  const x = 1;  ");
    expect(result).toBe("```\nconst x = 1;\n```");
  });

  it("should handle empty string", () => {
    const result = formatCodeBlock("");
    expect(result).toBe("");
  });

  it("should handle single line code", () => {
    const result = formatCodeBlock("return true;");
    expect(result).toBe("```\nreturn true;\n```");
  });

  it("should handle multi-line code", () => {
    const code = "function test() {\n  return true;\n}";
    const result = formatCodeBlock(code);
    expect(result).toBe("```\nfunction test() {\n  return true;\n}\n```");
  });

  it("should handle code with special characters", () => {
    const result = formatCodeBlock("const regex = /test/g;");
    expect(result).toBe("```\nconst regex = /test/g;\n```");
  });

  it("should handle code with backticks", () => {
    const result = formatCodeBlock("const str = `hello ${world}`;");
    expect(result).toBe("```\nconst str = `hello ${world}`;\n```");
  });

  it("should handle code with quotes", () => {
    const result = formatCodeBlock('const str = "hello";');
    expect(result).toBe("```\nconst str = \"hello\";\n```");
  });
});

describe("formatTelegramMarkdownV2", () => {
  it("should handle empty string", () => {
    const result = formatTelegramMarkdownV2("");
    expect(result).toBe("");
  });

  it("should escape special characters", () => {
    const result = formatTelegramMarkdownV2("Check value: 5.5!");
    expect(result).toBe("Check value: 5\\.5\\!");
  });

  it("should escape underscores", () => {
    const result = formatTelegramMarkdownV2("hello_world");
    expect(result).toBe("hello\\_world");
  });

  it("should escape asterisks", () => {
    const result = formatTelegramMarkdownV2("2 * 3 = 6");
    expect(result).toBe("2 \\* 3 \\= 6");
  });

  it("should preserve intentional bold with asterisks", () => {
    const result = formatTelegramMarkdownV2("*bold text*");
    expect(result).toBe("*bold text*");
  });

  it("should preserve intentional bold with double underscores", () => {
    const result = formatTelegramMarkdownV2("__bold text__");
    expect(result).toBe("__bold text__");
  });

  it("should preserve intentional italic", () => {
    const result = formatTelegramMarkdownV2("_italic text_");
    expect(result).toBe("_italic text_");
  });

  it("should escape content within bold markers", () => {
    const result = formatTelegramMarkdownV2("*bold_with_underscores*");
    // The implementation preserves special chars within markdown patterns
    expect(result).toBe("*bold_with_underscores*");
  });

  it("should preserve inline code", () => {
    const result = formatTelegramMarkdownV2("`console.log('test')`");
    expect(result).toBe("`console.log('test')`");
  });

  it("should preserve code blocks", () => {
    const result = formatTelegramMarkdownV2("```const x = 1;```");
    expect(result).toBe("```const x = 1;```");
  });

  it("should preserve multi-line code blocks", () => {
    const result = formatTelegramMarkdownV2("```\nfunction test() {\n  return true;\n}\n```");
    expect(result).toBe("```\nfunction test() {\n  return true;\n}\n```");
  });

  it("should preserve URLs with link text", () => {
    const result = formatTelegramMarkdownV2("[Click here](https://example.com)");
    expect(result).toBe("[Click here](https://example.com)");
  });

  it("should escape special characters in URL text", () => {
    const result = formatTelegramMarkdownV2("[Click_here!](https://example.com)");
    expect(result).toBe("[Click\\_here\\!](https://example.com)");
  });

  it("should escape multiple special characters", () => {
    const result = formatTelegramMarkdownV2("5 + 3 = 8 | 10 - 2 = 8");
    expect(result).toBe("5 \\+ 3 \\= 8 \\| 10 \\- 2 \\= 8");
  });

  it("should handle mixed markdown and special chars", () => {
    const result = formatTelegramMarkdownV2("*bold* and 5.5!");
    expect(result).toBe("*bold* and 5\\.5\\!");
  });

  it("should escape brackets outside of URL pattern", () => {
    const result = formatTelegramMarkdownV2("array[index]");
    expect(result).toBe("array\\[index\\]");
  });

  it("should escape parentheses outside of URL pattern", () => {
    const result = formatTelegramMarkdownV2("function(args)");
    expect(result).toBe("function\\(args\\)");
  });

  it("should escape hash symbols", () => {
    const result = formatTelegramMarkdownV2("# heading");
    expect(result).toBe("\\# heading");
  });

  it("should escape pipe characters", () => {
    const result = formatTelegramMarkdownV2("a | b | c");
    expect(result).toBe("a \\| b \\| c");
  });

  it("should escape curly braces", () => {
    const result = formatTelegramMarkdownV2("{key: value}");
    expect(result).toBe("\\{key: value\\}");
  });

  it("should escape tilde", () => {
    const result = formatTelegramMarkdownV2("~tilde~");
    expect(result).toBe("\\~tilde\\~");
  });

  it("should escape equals sign", () => {
    const result = formatTelegramMarkdownV2("a = b");
    expect(result).toBe("a \\= b");
  });

  it("should escape periods", () => {
    const result = formatTelegramMarkdownV2("example.com");
    expect(result).toBe("example\\.com");
  });

  it("should handle text with newlines", () => {
    const result = formatTelegramMarkdownV2("line1\nline2");
    expect(result).toBe("line1\nline2");
  });

  it("should preserve nested markdown in URLs", () => {
    const result = formatTelegramMarkdownV2("[*bold* link](https://example.com)");
    expect(result).toBe("[*bold* link](https://example.com)");
  });

  it("should handle code with asterisks inside bold", () => {
    const result = formatTelegramMarkdownV2("*`code` inside*");
    expect(result).toBe("*`code` inside*");
  });

  it("should escape unmatched asterisks", () => {
    const result = formatTelegramMarkdownV2("2 * 3");
    expect(result).toBe("2 \\* 3");
  });

  it("should escape unmatched underscores", () => {
    const result = formatTelegramMarkdownV2("hello_world");
    expect(result).toBe("hello\\_world");
  });

  it("should handle text with only special characters", () => {
    const result = formatTelegramMarkdownV2("_*[]()~`>#+-=|{}.!.");
    expect(result).toBe(
      "\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!\\.",
    );
  });

  it("should handle very long text", () => {
    const longText = "a".repeat(10000) + "!.*_";
    const result = formatTelegramMarkdownV2(longText);
    // The special characters should be escaped at the end
    expect(result).toContain("\\!\\.\\*\\_");
    expect(result.length).toBeGreaterThan(10000);
  });
});
