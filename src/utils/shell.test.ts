import { describe, test, expect } from "bun:test";
import { shellEscapeSingleQuotes } from "./shell";

describe("shellEscapeSingleQuotes", () => {
  test("escapes normal string", () => {
    expect(shellEscapeSingleQuotes("hello")).toBe("'hello'");
  });

  test("escapes string with spaces", () => {
    expect(shellEscapeSingleQuotes("hello world")).toBe("'hello world'");
  });

  test("escapes string with single quote", () => {
    expect(shellEscapeSingleQuotes("it's a test")).toBe("'it'\"'\"'s a test'");
  });

  test("escapes string with double quotes", () => {
    expect(shellEscapeSingleQuotes('hello "world"')).toBe('\'hello "world"\'');
  });

  test("escapes string with shell variables", () => {
    expect(shellEscapeSingleQuotes("$USER")).toBe("'$USER'");
    expect(shellEscapeSingleQuotes("${USER}")).toBe("'${USER}'");
  });

  test("escapes string with command injection", () => {
    expect(shellEscapeSingleQuotes("test && rm -rf /")).toBe("'test && rm -rf /'");
    expect(shellEscapeSingleQuotes("test; ls -l")).toBe("'test; ls -l'");
    expect(shellEscapeSingleQuotes("\`ls\`")).toBe("'\`ls\`'");
    expect(shellEscapeSingleQuotes("$(ls)")).toBe("'$(ls)'");
  });

  test("escapes string with backslashes", () => {
    expect(shellEscapeSingleQuotes("hello\\world")).toBe("'hello\\world'");
  });
});
