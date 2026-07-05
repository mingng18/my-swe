import { describe, it, expect } from "bun:test";
import { formatExistingPRMessage, PRContext } from "../pr-context";

describe("formatExistingPRMessage", () => {
  it("returns an empty string when PR doesn't exist", () => {
    const context: PRContext = { exists: false };
    expect(formatExistingPRMessage(context)).toBe("");
  });

  it("returns formatted message when PR exists with all details", () => {
    const context: PRContext = {
      exists: true,
      prUrl: "https://github.com/owner/repo/pull/123",
      prNumber: 123,
      branch: "open-swe/thread-id",
      repo: { owner: "owner", name: "repo" },
    };

    const result = formatExistingPRMessage(context);

    expect(result).toContain("[WARNING] EXISTING PULL REQUEST DETECTED");
    expect(result).toContain("- PR: #123");
    expect(result).toContain("- Branch: open-swe/thread-id");
    expect(result).toContain("- Repository: owner/repo");
    expect(result).toContain("- URL: https://github.com/owner/repo/pull/123");
  });

  it("handles missing optional fields gracefully", () => {
    const context: PRContext = {
      exists: true,
    };

    const result = formatExistingPRMessage(context);

    expect(result).toContain("[WARNING] EXISTING PULL REQUEST DETECTED");
    expect(result).toContain("- PR: #undefined");
    expect(result).toContain("- Branch: undefined");
    expect(result).toContain("- Repository: undefined/undefined");
    expect(result).toContain("- URL: undefined");
  });
});
