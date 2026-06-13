import { describe, it, expect } from "bun:test";
import { shellEscapeSingleQuotes } from "../shell";

describe("shellEscapeSingleQuotes", () => {
  it("escapes a simple string correctly", () => {
    expect(shellEscapeSingleQuotes("hello")).toBe("'hello'");
  });

  it("escapes strings with single quotes", () => {
    expect(shellEscapeSingleQuotes("it's a test")).toBe("'it'\\''s a test'");
  });

  it("throws an error on null bytes", () => {
    expect(() => shellEscapeSingleQuotes("hello\0world")).toThrow("null byte");
  });

  it("throws an error on oversized input", () => {
    const longString = "a".repeat(4097);
    expect(() => shellEscapeSingleQuotes(longString)).toThrow("too long");
  });

  it("throws an error on dangerous pattern: $(", () => {
    expect(() => shellEscapeSingleQuotes("echo $(id)")).toThrow("dangerous pattern");
  });

  it("throws an error on dangerous pattern: backticks", () => {
    expect(() => shellEscapeSingleQuotes("echo `id`")).toThrow("dangerous pattern");
  });

  it("throws an error on dangerous pattern: ${", () => {
    expect(() => shellEscapeSingleQuotes("echo ${USER}")).toThrow("dangerous pattern");
  });

  it("throws an error on dangerous pattern: |", () => {
    expect(() => shellEscapeSingleQuotes("echo | ls")).toThrow("dangerous pattern");
  });

  it("throws an error on dangerous pattern: ;", () => {
    expect(() => shellEscapeSingleQuotes("echo; ls")).toThrow("dangerous pattern");
  });

  it("throws an error on dangerous pattern: &&", () => {
    expect(() => shellEscapeSingleQuotes("echo && ls")).toThrow("dangerous pattern");
  });

  it("throws an error on dangerous pattern: ||", () => {
    expect(() => shellEscapeSingleQuotes("echo || ls")).toThrow("dangerous pattern");
  });

  it("throws an error on dangerous pattern: \\r", () => {
    expect(() => shellEscapeSingleQuotes("echo\rls")).toThrow("dangerous pattern");
  });

  it("throws an error on dangerous pattern: \\n", () => {
    expect(() => shellEscapeSingleQuotes("echo\nls")).toThrow("dangerous pattern");
  });

  it("throws an error on dangerous pattern: \\$", () => {
    expect(() => shellEscapeSingleQuotes("echo \\$USER")).toThrow("dangerous pattern");
  });
});
