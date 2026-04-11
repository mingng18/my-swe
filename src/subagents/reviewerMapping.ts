/**
 * Maps file patterns to applicable reviewer agents for automatic reviewer selection during pre-commit hooks.
 */

export interface ReviewerMapping {
  patterns: string[];
  reviewers: string[];
}

export const REVIEWER_MAPPINGS: ReviewerMapping[] = [
  {
    patterns: ["\\.go$"],
    reviewers: ["code-reviewer", "go-reviewer"]
  },
  {
    patterns: ["\\.py$"],
    reviewers: ["code-reviewer", "python-reviewer"]
  },
  {
    patterns: ["\\.sql$", "migration", "schema"],
    reviewers: ["code-reviewer", "database-reviewer"]
  },
  {
    patterns: ["auth", "login", "password", "routes", "api"],
    reviewers: ["code-reviewer", "security-reviewer"]
  }
];

/**
 * Get reviewers for a single file based on its path
 */
export function getReviewersForFile(filePath: string): string[] {
  const defaultReviewers = ["code-reviewer"];

  for (const mapping of REVIEWER_MAPPINGS) {
    if (mapping.patterns.some(pattern =>
      filePath.includes(pattern) ||
      (pattern.startsWith("\\.") && new RegExp(pattern).test(filePath))
    )) {
      return [...new Set([...mapping.reviewers, ...defaultReviewers])];
    }
  }

  return defaultReviewers;
}

/**
 * Get unique reviewers for multiple files
 */
export function getReviewersForFiles(filePaths: string[]): string[] {
  const allReviewers = new Set<string>();

  filePaths.forEach(filePath => {
    const reviewers = getReviewersForFile(filePath);
    reviewers.forEach(reviewer => allReviewers.add(reviewer));
  });

  return Array.from(allReviewers);
}

/**
 * Check if a specific reviewer should review a file based on file path
 */
export function shouldReviewerReviewFile(filePath: string, reviewerName: string): boolean {
  const reviewersForFile = getReviewersForFile(filePath);
  return reviewersForFile.includes(reviewerName);
}