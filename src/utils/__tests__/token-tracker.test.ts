import { describe, it, expect } from "bun:test";
import { calculateCost } from "../token-tracker";

describe("calculateCost", () => {
  it("calculates cost correctly for exact model match (gpt-4o)", () => {
    // gpt-4o pricing: input 2.5/M, output 10/M
    // 1M input = $2.5, 1M output = $10. Total = $12.5
    const cost = calculateCost("gpt-4o", 1_000_000, 1_000_000);
    expect(cost).toBe(12.5);
  });

  it("calculates cost correctly for prefix model match (openrouter/anthropic/claude)", () => {
    // openrouter/ pricing: input 1/M, output 2/M
    // 2M input = $2, 500k output = $1. Total = $3
    const cost = calculateCost(
      "openrouter/anthropic/claude-3-opus",
      2_000_000,
      500_000,
    );
    expect(cost).toBe(3);
  });

  it("calculates cost using default fallback pricing for unknown models", () => {
    // Default pricing: input 1/M, output 2/M
    // 500k input = $0.5, 1M output = $2. Total = $2.5
    const cost = calculateCost("unknown-future-model", 500_000, 1_000_000);
    expect(cost).toBe(2.5);
  });

  it("handles zero tokens correctly", () => {
    const cost = calculateCost("gpt-4o", 0, 0);
    expect(cost).toBe(0);
  });

  it("handles fractional costs for small token amounts", () => {
    // gpt-4o-mini pricing: input 0.15/M, output 0.6/M
    // 10 input = $0.0000015, 10 output = $0.000006. Total = $0.0000075
    const cost = calculateCost("gpt-4o-mini", 10, 10);
    expect(cost).toBeCloseTo(0.0000075, 10);
  });
});
