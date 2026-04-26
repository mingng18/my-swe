import { describe, it, expect } from "bun:test";
import {
  parseReviewerOutput,
  filterIssuesBySeverity,
  hasCriticalIssues,
  formatIssues,
  ReviewIssue,
} from "../reviewerParser";

describe("parseReviewerOutput", () => {
  const validReviewOutput = `

[CRITICAL]
File: src/main.ts:10
Issue: Potential null reference in authentication flow
Fix: Add null check before accessing user object

[HIGH]
File: utils/validation.ts
Issue: Missing input validation
Fix: Add schema validation for incoming request

[MEDIUM]
File: components/Header.tsx:25
Issue: Unused CSS class in component
Fix: Remove unused className to reduce bundle size

[LOW]
File: README.md
Issue: Missing section in documentation
Fix: Add installation instructions

[CRITICAL]
File: src/database.ts
Issue: SQL injection vulnerability in query builder
Fix: Use parameterized queries instead of string interpolation
`;

  it("parses multiple issues correctly", () => {
    const issues = parseReviewerOutput(validReviewOutput);

    expect(issues).toHaveLength(5);
    expect(issues[0]).toEqual({
      severity: "CRITICAL",
      file: "src/main.ts",
      line: 10,
      issue: "Potential null reference in authentication flow",
      fix: "Add null check before accessing user object",
    });

    expect(issues[1]).toEqual({
      severity: "HIGH",
      file: "utils/validation.ts",
      issue: "Missing input validation",
      fix: "Add schema validation for incoming request",
    });

    expect(issues[2]).toEqual({
      severity: "MEDIUM",
      file: "components/Header.tsx",
      line: 25,
      issue: "Unused CSS class in component",
      fix: "Remove unused className to reduce bundle size",
    });

    expect(issues[3]).toEqual({
      severity: "LOW",
      file: "README.md",
      issue: "Missing section in documentation",
      fix: "Add installation instructions",
    });

    expect(issues[4]).toEqual({
      severity: "CRITICAL",
      file: "src/database.ts",
      issue: "SQL injection vulnerability in query builder",
      fix: "Use parameterized queries instead of string interpolation",
    });
  });

  it("parses severity correctly", () => {
    const issues = parseReviewerOutput(validReviewOutput);
    const severities = issues.map((issue) => issue.severity);

    expect(severities).toEqual([
      "CRITICAL",
      "HIGH",
      "MEDIUM",
      "LOW",
      "CRITICAL",
    ]);
  });

  it("parses file and line number", () => {
    const issues = parseReviewerOutput(validReviewOutput);

    // Issue with line number
    expect(issues[0].file).toBe("src/main.ts");
    expect(issues[0].line).toBe(10);

    // Issue without line number
    expect(issues[1].file).toBe("utils/validation.ts");
    expect(issues[1].line).toBeUndefined();

    // Issue with line number
    expect(issues[2].file).toBe("components/Header.tsx");
    expect(issues[2].line).toBe(25);
  });

  it("handles issues without line numbers", () => {
    const output = `[HIGH]
File: utils/validation.ts
Issue: Missing input validation
Fix: Add schema validation for incoming request`;

    const issues = parseReviewerOutput(output);

    expect(issues).toHaveLength(1);
    expect(issues[0].file).toBe("utils/validation.ts");
    expect(issues[0].line).toBeUndefined();
  });

  it("returns empty array for invalid output", () => {
    const invalidOutputs = [
      "",
      "Invalid format",
      "Not a review output",
      `[LOW]
File: somefile.ts
Issue: Missing description`,
      `[MEDIUM]
File: another.ts
Fix: Missing issue description`,
      `[SEVERITY]
File: test.ts
Issue: Test issue
Fix: Test fix`,
    ];

    for (const output of invalidOutputs) {
      const issues = parseReviewerOutput(output);
      expect(issues).toEqual([]);
    }
  });

  it("handles malformed sections gracefully", () => {
    const malformedOutput = `[CRITICAL]
File: src/test.ts
Issue: Test issue
Fix: Test fix

[MEDIUM]
File: incomplete

[INVALID]
File: bad.ts
Issue: Bad issue
Fix: Bad fix`;

    const issues = parseReviewerOutput(malformedOutput);

    // Should only parse the valid CRITICAL issue
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("CRITICAL");
  });
});

describe("filterIssuesBySeverity", () => {
  const testIssues: ReviewIssue[] = [
    {
      severity: "CRITICAL",
      file: "a.ts",
      line: 1,
      issue: "Critical issue",
      fix: "Fix critical",
    },
    {
      severity: "HIGH",
      file: "b.ts",
      line: 2,
      issue: "High issue",
      fix: "Fix high",
    },
    {
      severity: "MEDIUM",
      file: "c.ts",
      line: 3,
      issue: "Medium issue",
      fix: "Fix medium",
    },
    {
      severity: "LOW",
      file: "d.ts",
      line: 4,
      issue: "Low issue",
      fix: "Fix low",
    },
    {
      severity: "CRITICAL",
      file: "e.ts",
      line: 5,
      issue: "Another critical",
      fix: "Fix critical 2",
    },
  ];

  it("filters by HIGH severity (CRITICAL + HIGH)", () => {
    const filtered = filterIssuesBySeverity(testIssues, "HIGH");

    expect(filtered).toHaveLength(3);
    expect(
      filtered.every((issue) => ["CRITICAL", "HIGH"].includes(issue.severity)),
    ).toBe(true);

    // Check that all HIGH and CRITICAL issues are included
    expect(filtered.find((i) => i.severity === "CRITICAL")).toBeDefined();
    expect(filtered.find((i) => i.severity === "HIGH")).toBeDefined();
  });

  it("filters by CRITICAL severity (only CRITICAL)", () => {
    const filtered = filterIssuesBySeverity(testIssues, "CRITICAL");

    expect(filtered).toHaveLength(2);
    expect(filtered.every((issue) => issue.severity === "CRITICAL")).toBe(true);
  });

  it("returns all for LOW severity", () => {
    const filtered = filterIssuesBySeverity(testIssues, "LOW");

    expect(filtered).toHaveLength(5);
    expect(
      filtered.every((issue) =>
        ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(issue.severity),
      ),
    ).toBe(true);
  });

  it("handles empty input array", () => {
    const filtered = filterIssuesBySeverity([], "HIGH");
    expect(filtered).toEqual([]);
  });
});

describe("hasCriticalIssues", () => {
  it("returns true when CRITICAL issues exist", () => {
    const issues: ReviewIssue[] = [
      { severity: "HIGH", file: "a.ts", issue: "High issue", fix: "Fix" },
      {
        severity: "CRITICAL",
        file: "b.ts",
        line: 1,
        issue: "Critical issue",
        fix: "Fix",
      },
    ];

    expect(hasCriticalIssues(issues)).toBe(true);
  });

  it("returns false when no CRITICAL issues", () => {
    const issues: ReviewIssue[] = [
      { severity: "HIGH", file: "a.ts", issue: "High issue", fix: "Fix" },
      {
        severity: "MEDIUM",
        file: "b.ts",
        line: 1,
        issue: "Medium issue",
        fix: "Fix",
      },
    ];

    expect(hasCriticalIssues(issues)).toBe(false);
  });

  it("returns false for empty array", () => {
    expect(hasCriticalIssues([])).toBe(false);
  });
});

describe("formatIssues", () => {
  const testIssues: ReviewIssue[] = [
    {
      severity: "CRITICAL",
      file: "security.ts",
      line: 10,
      issue: "SQL injection vulnerability",
      fix: "Use parameterized queries",
    },
    {
      severity: "LOW",
      file: "style.css",
      issue: "Unused CSS rule",
      fix: "Remove unused style",
    },
    {
      severity: "HIGH",
      file: "auth.js",
      line: 5,
      issue: "Missing authentication",
      fix: "Add auth middleware",
    },
  ];

  it("formats issues correctly with severity, file, line, fix", () => {
    const formatted = formatIssues(testIssues);

    expect(formatted).toContain("CRITICAL Issues (1):");
    expect(formatted).toContain("HIGH Issues (1):");
    expect(formatted).toContain("LOW Issues (1):");

    // Check specific formatting
    expect(formatted).toContain("File: security.ts:10");
    expect(formatted).toContain("Issue: SQL injection vulnerability");
    expect(formatted).toContain("Fix: Use parameterized queries");

    expect(formatted).toContain("File: auth.js:5");
    expect(formatted).toContain("Issue: Missing authentication");
    expect(formatted).toContain("Fix: Add auth middleware");

    expect(formatted).toContain("File: style.css");
    expect(formatted).toContain("Issue: Unused CSS rule");
    expect(formatted).toContain("Fix: Remove unused style");
  });

  it("handles empty array", () => {
    const formatted = formatIssues([]);
    expect(formatted).toBe("No issues found.");
  });

  it("handles single issue", () => {
    const singleIssue: ReviewIssue[] = [
      {
        severity: "MEDIUM",
        file: "test.ts",
        line: 1,
        issue: "Medium issue",
        fix: "Medium fix",
      },
    ];

    const formatted = formatIssues(singleIssue);

    expect(formatted).toContain("MEDIUM Issues (1):");
    expect(formatted).toContain("File: test.ts:1");
    expect(formatted).toContain("Issue: Medium issue");
    expect(formatted).toContain("Fix: Medium fix");
  });
});
