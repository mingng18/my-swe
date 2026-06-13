import { expect, test, describe, mock } from "bun:test";

mock.module("@daytonaio/sdk", () => ({
  Daytona: class DaytonaMock {}
}));

import { normalizeProfile } from "../daytona-pool";

describe("daytona-pool", () => {
  describe("normalizeProfile", () => {
    test("returns 'typescript' by default for undefined", () => {
      expect(normalizeProfile()).toBe("typescript");
      expect(normalizeProfile(undefined)).toBe("typescript");
    });

    test("returns 'typescript' for empty string", () => {
      expect(normalizeProfile("")).toBe("typescript");
      expect(normalizeProfile("   ")).toBe("typescript");
    });

    test("returns valid profiles directly", () => {
      expect(normalizeProfile("typescript")).toBe("typescript");
      expect(normalizeProfile("javascript")).toBe("javascript");
      expect(normalizeProfile("python")).toBe("python");
      expect(normalizeProfile("java")).toBe("java");
      expect(normalizeProfile("polyglot")).toBe("polyglot");
    });

    test("handles case insensitivity", () => {
      expect(normalizeProfile("TypeScript")).toBe("typescript");
      expect(normalizeProfile("PYTHON")).toBe("python");
      expect(normalizeProfile("Java")).toBe("java");
    });

    test("handles leading and trailing whitespace", () => {
      expect(normalizeProfile("  javascript  ")).toBe("javascript");
      expect(normalizeProfile("\tpython\n")).toBe("python");
    });

    test("returns 'typescript' as fallback for invalid profiles", () => {
      expect(normalizeProfile("ruby")).toBe("typescript");
      expect(normalizeProfile("go")).toBe("typescript");
      expect(normalizeProfile("invalid-profile")).toBe("typescript");
    });
  });
});
