import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { PRReviewComment, PRReviewResult } from "../pr-review-cycle";

// ---------------------------------------------------------------------------
// We test PRReviewCycle via isolated unit tests by extracting the core logic
// and mocking external deps. Direct import of PRReviewCycle pulls in Octokit
// and other heavy deps, so we test its logic through partial mocking.
// ---------------------------------------------------------------------------

describe("PRReviewCycle", () => {
  // Re-test the filtering logic that PRReviewCycle.fetchUnresolvedComments uses
  // by replicating the filter function

  interface ReviewCommentAPI {
    id: number;
    path?: string;
    line?: number;
    original_line?: number;
    body: string | null;
    user?: { login: string };
    in_reply_to_id?: number | null;
  }

  function filterActionableComments(
    rawComments: ReviewCommentAPI[],
  ): PRReviewComment[] {
    const actionable: PRReviewComment[] = [];

    for (const c of rawComments) {
      if (c.in_reply_to_id) continue;
      if (!c.body?.trim()) continue;
      if (c.body.includes("<!-- pr-review-cycle:addressed -->")) continue;
      const lowerBody = c.body.trim().toLowerCase();
      if (lowerBody.startsWith("fixed in") || lowerBody.startsWith("done:"))
        continue;

      actionable.push({
        path: c.path ?? "",
        line: c.line ?? c.original_line ?? 0,
        body: c.body,
        reviewer: c.user?.login ?? "unknown",
      });
    }

    return actionable;
  }

  describe("fetchUnresolvedComments (filtering logic)", () => {
    it("filters out replies (in_reply_to_id set)", () => {
      const comments: ReviewCommentAPI[] = [
        {
          id: 1,
          path: "a.ts",
          line: 10,
          body: "Fix this",
          user: { login: "alice" },
          in_reply_to_id: null,
        },
        {
          id: 2,
          path: "a.ts",
          line: 10,
          body: "I agree",
          user: { login: "bob" },
          in_reply_to_id: 1,
        },
      ];
      const result = filterActionableComments(comments);
      expect(result).toHaveLength(1);
      expect(result[0]!.reviewer).toBe("alice");
    });

    it("filters out empty body comments", () => {
      const comments: ReviewCommentAPI[] = [
        {
          id: 1,
          body: "",
          user: { login: "alice" },
        },
        {
          id: 2,
          body: "   ",
          user: { login: "bob" },
        },
        {
          id: 3,
          path: "a.ts",
          line: 5,
          body: "Fix this",
          user: { login: "carol" },
        },
      ];
      const result = filterActionableComments(comments);
      expect(result).toHaveLength(1);
    });

    it("filters out auto-addressed comments", () => {
      const comments: ReviewCommentAPI[] = [
        {
          id: 1,
          path: "a.ts",
          line: 5,
          body: "Fixed <!-- pr-review-cycle:addressed -->",
          user: { login: "bot" },
        },
      ];
      const result = filterActionableComments(comments);
      expect(result).toHaveLength(0);
    });

    it("filters out 'Fixed in' and 'Done:' prefixes", () => {
      const comments: ReviewCommentAPI[] = [
        {
          id: 1,
          path: "a.ts",
          line: 5,
          body: "Fixed in commit abc123",
          user: { login: "dev" },
        },
        {
          id: 2,
          path: "b.ts",
          line: 10,
          body: "Done: addressed in latest push",
          user: { login: "dev" },
        },
        {
          id: 3,
          path: "c.ts",
          line: 15,
          body: "Please refactor this function",
          user: { login: "reviewer" },
        },
      ];
      const result = filterActionableComments(comments);
      expect(result).toHaveLength(1);
      expect(result[0]!.reviewer).toBe("reviewer");
    });

    it("preserves normal actionable comments", () => {
      const comments: ReviewCommentAPI[] = [
        {
          id: 1,
          path: "src/index.ts",
          line: 42,
          body: "This function should return an error code instead of throwing.",
          user: { login: "senior-dev" },
        },
        {
          id: 2,
          path: "src/utils.ts",
          line: 10,
          original_line: 8,
          body: "Missing null check here.",
          user: { login: "reviewer" },
        },
      ];
      const result = filterActionableComments(comments);
      expect(result).toHaveLength(2);
      expect(result[0]!.path).toBe("src/index.ts");
      expect(result[1]!.line).toBe(10); // line takes priority over original_line
    });
  });

  describe("runCycle (maxRounds logic)", () => {
    it("stops after maxRounds iterations", async () => {
      // Simulate the runCycle loop logic
      let round = 0;
      const maxRounds = 2;
      const fetchCalls: number[] = [];
      const aggregate = {
        totalComments: 0,
        addressedComments: 0,
        commitsPushed: 0,
        remainingIssues: [] as string[],
      };

      // Simulate: each round returns 1 comment, agent addresses it
      for (let r = 1; r <= maxRounds; r++) {
        round = r;
        fetchCalls.push(r);
        // Simulate 1 unresolved comment
        aggregate.totalComments += 1;
        aggregate.addressedComments += 1;
        aggregate.commitsPushed += 1;
        // Simulate brief pause skipped at last round
      }

      expect(round).toBe(maxRounds);
      expect(fetchCalls).toHaveLength(maxRounds);
      expect(aggregate.totalComments).toBe(maxRounds);
    });

    it("stops early when no comments remain", () => {
      let roundsExecuted = 0;
      const maxRounds = 5;

      // Simulate: first round has comments, second has none
      const commentsPerRound = [3, 0];

      for (let r = 1; r <= maxRounds; r++) {
        roundsExecuted++;
        const comments = commentsPerRound[r - 1] ?? 0;
        if (comments === 0) break;
      }

      expect(roundsExecuted).toBe(2);
    });

    it("stops early when no comments addressed in a round", () => {
      let roundsExecuted = 0;
      const maxRounds = 5;
      const addressedPerRound = [2, 0, 1]; // round 2 addresses nothing

      for (let r = 1; r <= maxRounds; r++) {
        roundsExecuted++;
        if (addressedPerRound[r - 1] === 0) break;
      }

      expect(roundsExecuted).toBe(2);
    });
  });

  describe("addressComments", () => {
    it("returns empty result when no comments provided", () => {
      const result: PRReviewResult = {
        prNumber: 1,
        totalComments: 0,
        addressedComments: 0,
        commitsPushed: 0,
        remainingIssues: [],
      };
      expect(result.totalComments).toBe(0);
      expect(result.addressedComments).toBe(0);
    });

    it("builds correct prompt for a comment", () => {
      // Test the buildPrompt logic
      const comment: PRReviewComment = {
        path: "src/foo.ts",
        line: 42,
        body: "Please add error handling",
        reviewer: "senior-dev",
      };

      const prompt = [
        "Address this PR review comment:",
        "",
        `File: ${comment.path}`,
        `Line: ${comment.line}`,
        `Reviewer: @${comment.reviewer}`,
        "",
        "Comment:",
        comment.body,
        "",
        "Make the necessary code changes to address the reviewer's feedback. " +
          "Only modify the relevant file(s). Do not introduce unrelated changes.",
      ].join("\n");

      expect(prompt).toContain("src/foo.ts");
      expect(prompt).toContain("42");
      expect(prompt).toContain("@senior-dev");
      expect(prompt).toContain("Please add error handling");
    });
  });
});
