import { describe, it, expect } from "bun:test";
import { escapeRegex } from "../regex";

describe("escapeRegex", () => {
  it("escapes regex special characters", () => {
    expect(escapeRegex(".*+?^${}()|[]\\")).toBe("\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\");
  });

  it("does not escape normal characters", () => {
    expect(escapeRegex("hello world 123")).toBe("hello world 123");
  });

  it("handles mixed strings", () => {
    expect(escapeRegex("Price: $10.00 (tax included)!")).toBe("Price: \\$10\\.00 \\(tax included\\)!");
  });

  it("handles empty strings", () => {
    expect(escapeRegex("")).toBe("");
  });
});
