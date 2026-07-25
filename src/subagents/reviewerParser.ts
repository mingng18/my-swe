export interface ReviewIssue {
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  file: string;
  line?: number;
  issue: string;
  fix: string;
}

export function parseReviewerOutput(output: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const sections = output.split("\n\n").filter((section) => section.trim());

  for (const section of sections) {
    const issue = parseSingleIssue(section.trim());
    if (issue) {
      issues.push(issue);
    }
  }

  return issues;
}

function parseSingleIssue(section: string): ReviewIssue | null {
  const lines = section.split("\n");
  if (lines.length < 4) return null;

  const severityLine = lines[0];
  const fileLine = lines[1];
  const issueLine = lines[2];
  const fixLine = lines[3];

  // Parse severity
  const severityMatch = severityLine.match(/^\[([A-Z]+)\]/);
  if (!severityMatch) return null;

  const severity = severityMatch[1] as ReviewIssue["severity"];
  if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(severity)) {
    return null;
  }

  // Parse file and line
  const fileMatch = fileLine.match(/^File:\s+(.+?)(?::(\d+))?$/);
  if (!fileMatch) return null;

  const file = fileMatch[1];
  const line = fileMatch[2] ? parseInt(fileMatch[2], 10) : undefined;

  // Parse issue
  const issueMatch = issueLine.match(/^Issue:\s+(.+)$/);
  if (!issueMatch) return null;

  const issue = issueMatch[1];

  // Parse fix
  const fixMatch = fixLine.match(/^Fix:\s+(.+)$/);
  if (!fixMatch) return null;

  const fix = fixMatch[1];

  return {
    severity,
    file,
    line,
    issue,
    fix,
  };
}

export function filterIssuesBySeverity(
  issues: ReviewIssue[],
  minSeverity: ReviewIssue["severity"],
): ReviewIssue[] {
  const severityOrder = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const minIndex = severityOrder.indexOf(minSeverity);

  return issues.filter(
    (issue) => severityOrder.indexOf(issue.severity) >= minIndex,
  );
}

export function hasCriticalIssues(issues: ReviewIssue[]): boolean {
  return issues.some((issue) => issue.severity === "CRITICAL");
}

export function formatIssues(issues: ReviewIssue[]): string {
  if (issues.length === 0) return "No issues found.";

  // ⚡ Bolt: Replaced .reduce() and string concatenation with a single-pass for loop and .join() to avoid intermediate array allocations and reduce garbage collection pressure.
  const grouped: Record<string, ReviewIssue[]> = {};
  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
    if (!grouped[issue.severity]) {
      grouped[issue.severity] = [];
    }
    grouped[issue.severity].push(issue);
  }

  const severityOrder = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
  const outputParts: string[] = [];

  for (let i = 0; i < severityOrder.length; i++) {
    const severity = severityOrder[i];
    const severityGroup = grouped[severity];
    if (severityGroup?.length) {
      outputParts.push(`\n\n${severity} Issues (${severityGroup.length}):\n`);
      outputParts.push("=".repeat(50) + "\n");

      for (let j = 0; j < severityGroup.length; j++) {
        const issue = severityGroup[j];
        outputParts.push(`File: ${issue.file}${issue.line ? `:${issue.line}` : ""}\n`);
        outputParts.push(`Issue: ${issue.issue}\n`);
        outputParts.push(`Fix: ${issue.fix}\n`);
        outputParts.push("-".repeat(50) + "\n");
      }
    }
  }

  return outputParts.join("").trim();
}
