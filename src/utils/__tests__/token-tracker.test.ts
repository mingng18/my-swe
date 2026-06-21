import { describe, it, expect, beforeEach } from "bun:test";
import { calculateCost, checkBudget, trackTokenUsage, clearTokenUsage } from "../token-tracker";

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

describe("checkBudget", () => {
  const threadId = "test-check-budget-thread";

  beforeEach(() => {
    clearTokenUsage(threadId);
  });

  it("returns withinBudget: true if no usage exists", () => {
    const result = checkBudget(threadId, 100, 100);
    expect(result.withinBudget).toBe(true);
    expect(result.currentUsage).toBeNull();
  });

  it("returns withinBudget: true if usage is within limits", () => {
    trackTokenUsage(threadId, "gpt-4o", 1000, 1000);
    const result = checkBudget(threadId, 100, 100);
    expect(result.withinBudget).toBe(true);
    expect(result.currentUsage).not.toBeNull();
  });

  it("returns withinBudget: false if token limit is exceeded", () => {
    // Default MAX_TOKENS_PER_THREAD is 500,000
    trackTokenUsage(threadId, "gpt-4o", 250000, 250000); // exactly 500,000 tokens
    const result = checkBudget(threadId, 1, 0); // requesting 1 more token exceeds the limit
    expect(result.withinBudget).toBe(false);
    expect(result.reason).toContain("Token limit exceeded");
  });

  it("returns withinBudget: false if cost limit is exceeded", () => {
    // Default MAX_COST_PER_THREAD is 10.0
    // Track usage with a very expensive model so cost is near $10 but tokens are low
    // gpt-4 has 30/M input, 60/M output. Let's use 166,600 output tokens to get close to $10.0
    // cost = (166,600 / 1,000,000) * 60 = 9.996
    trackTokenUsage(threadId, "gpt-4", 0, 166600);

    // Now request tokens with estimated cost ($2 per 1M tokens) that pushes it over
    // Let's request 5,000 tokens which adds an estimated $0.010, pushing cost over $10.0
    // Total tokens will be 166,600 + 5,000 = 171,600 < 500,000 (token limit not exceeded)
    const result = checkBudget(threadId, 5000, 0);
    expect(result.withinBudget).toBe(false);
    expect(result.reason).toContain("Cost limit exceeded");
  });

  it("handles exact boundary of token limit", () => {
    trackTokenUsage(threadId, "gpt-4o", 250000, 250000); // totalTokens = 500,000
    // Requesting 0 tokens leaves total at exactly 500,000, which is NOT > 500,000
    const result = checkBudget(threadId, 0, 0);
    expect(result.withinBudget).toBe(true);
  });
});
