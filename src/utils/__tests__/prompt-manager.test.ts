import { describe, it, expect } from "bun:test";
import { getPromptTier, PromptTier } from "../prompt-manager";

describe("prompt-manager", () => {
  describe("getPromptTier", () => {
    it("returns FULL tier for context tokens less than 30,000", () => {
      expect(getPromptTier(100)).toBe(PromptTier.FULL);
      expect(getPromptTier(29999)).toBe(PromptTier.FULL);
    });

    it("returns STANDARD tier for context tokens exactly 30,000", () => {
      expect(getPromptTier(30000)).toBe(PromptTier.STANDARD);
    });

    it("returns STANDARD tier for context tokens between 30,000 and 59,999", () => {
      expect(getPromptTier(45000)).toBe(PromptTier.STANDARD);
      expect(getPromptTier(59999)).toBe(PromptTier.STANDARD);
    });

    it("returns MINIMAL tier for context tokens exactly 60,000", () => {
      expect(getPromptTier(60000)).toBe(PromptTier.MINIMAL);
    });

    it("returns MINIMAL tier for context tokens greater than 60,000", () => {
      expect(getPromptTier(75000)).toBe(PromptTier.MINIMAL);
      expect(getPromptTier(150000)).toBe(PromptTier.MINIMAL);
    });

    it("handles zero context tokens correctly (returns FULL tier)", () => {
      expect(getPromptTier(0)).toBe(PromptTier.FULL);
    });

    it("handles negative context tokens correctly (returns FULL tier)", () => {
      expect(getPromptTier(-100)).toBe(PromptTier.FULL);
    });
  });
});
