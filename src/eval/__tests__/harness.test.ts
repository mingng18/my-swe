import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { EvalCase } from "../harness";

// ---------------------------------------------------------------------------
// Extract and test internal functions directly from the module source.
// We avoid importing EvalHarness directly since it has heavy deps.
// ---------------------------------------------------------------------------

// Test parsePrUrl logic by re-implementing (it's a private util)
function parsePrUrl(prUrl: string) {
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], prNumber: Number(match[3]) };
}

// Test extractPrUrl logic
function extractPrUrl(reply: string) {
  const match = reply.match(
    /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/,
  );
  return match ? match[0] : undefined;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EvalHarness utilities", () => {
  describe("parsePrUrl", () => {
    it("parses a valid PR URL", () => {
      const result = parsePrUrl("https://github.com/owner/repo/pull/123");
      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
        prNumber: 123,
      });
    });

    it("returns null for invalid URL", () => {
      expect(parsePrUrl("https://example.com")).toBeNull();
      expect(parsePrUrl("not-a-url")).toBeNull();
    });

    it("returns null for a GitHub URL that is not a PR", () => {
      expect(
        parsePrUrl("https://github.com/owner/repo/issues/5"),
      ).toBeNull();
    });
  });

  describe("extractPrUrl", () => {
    it("extracts a PR URL from agent reply text", () => {
      const reply =
        "I've created the PR at https://github.com/owner/repo/pull/42 for review.";
      expect(extractPrUrl(reply)).toBe(
        "https://github.com/owner/repo/pull/42",
      );
    });

    it("returns undefined when no PR URL is found", () => {
      expect(extractPrUrl("I made the changes")).toBeUndefined();
    });
  });
});

describe("EvalHarness", () => {
  describe("constructor", () => {
    it("can be instantiated", async () => {
      // Dynamic import to avoid top-level side effects from real harness
      const { EvalHarness: EH } = await import("../harness");
      const h = new EH();
      expect(h).toBeDefined();
      expect(typeof h.runCase).toBe("function");
      expect(typeof h.runSuite).toBe("function");
      expect(typeof h.checkPrPasses).toBe("function");
    });
  });

  describe("checkPrPasses", () => {
    it("returns failure for an invalid PR URL", async () => {
      const { EvalHarness: EH } = await import("../harness");
      const h = new EH();
      const result = await h.checkPrPasses("not-a-url", []);
      expect(result.passed).toBe(false);
      expect(result.output).toContain("Could not parse");
    });
  });

  describe("runSuite", () => {
    it("produces a well-formed report", async () => {
      const { EvalHarness: EH } = await import("../harness");
      const h = new EH();

      // We'll spy on runCase to avoid real agent invocations
      const originalRunCase = h.runCase.bind(h);
      const mockRunCase = mock(async (_c: EvalCase) => ({
        caseId: _c.id,
        passed: true,
        prUrl: "https://github.com/o/r/pull/1",
        durationMs: 100,
      }));
      h.runCase = mockRunCase;

      const cases: EvalCase[] = [
        { id: "a", repo: "o/r", issueNumber: 0, description: "A" },
        { id: "b", repo: "o/r", issueNumber: 0, description: "B" },
      ];

      const report = await h.runSuite(cases);
      expect(report.totalCases).toBe(2);
      expect(report.results).toHaveLength(2);
      expect(report.passed).toBe(2);
      expect(report.failed).toBe(0);
      expect(typeof report.avgDurationMs).toBe("number");
      expect(typeof report.timestamp).toBe("string");
    });
  });
});
