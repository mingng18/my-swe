import { describe, expect, it } from "bun:test";
import { formatPRResults } from "../PRSubmitNode";
import type { PRSubmitNodeState } from "../PRSubmitNode";

describe("formatPRResults", () => {
  it("should return correct message when there are no changes", () => {
    const state = { hasChanges: false } as PRSubmitNodeState;
    expect(formatPRResults(state)).toBe("ℹ️ No changes to commit");
  });

  it("should return success message when PR is created", () => {
    const state = {
      hasChanges: true,
      prCreated: true,
      prUrl: "https://github.com/org/repo/pull/123"
    } as PRSubmitNodeState;

    expect(formatPRResults(state)).toBe("✅ PR created: https://github.com/org/repo/pull/123");
  });

  it("should return failure message with specific error when PR creation fails", () => {
    const state = {
      hasChanges: true,
      prCreated: false,
      error: "API rate limit exceeded"
    } as PRSubmitNodeState;

    expect(formatPRResults(state)).toBe("❌ PR creation failed: API rate limit exceeded");
  });

  it("should return failure message with default error when PR creation fails without specific error", () => {
    const state = {
      hasChanges: true,
      prCreated: false
    } as PRSubmitNodeState;

    expect(formatPRResults(state)).toBe("❌ PR creation failed: Unknown error");
  });
});
