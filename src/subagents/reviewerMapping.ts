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
    reviewers: ["code-reviewer", "go-reviewer"],
  },
  {
    patterns: ["\\.py$"],
    reviewers: ["code-reviewer", "python-reviewer"],
  },
  {
    patterns: ["\\.ts$", "\\.tsx$"],
    reviewers: ["code-reviewer", "typescript-reviewer"],
  },
  {
    patterns: ["\\.rs$"],
    reviewers: ["code-reviewer", "rust-reviewer"],
  },
  {
    patterns: ["\\.java$"],
    reviewers: ["code-reviewer", "java-reviewer"],
  },
  {
    patterns: ["\\.sql$", "migration", "schema"],
    reviewers: ["code-reviewer", "database-reviewer"],
  },
  {
    patterns: ["auth", "login", "password", "routes", "api"],
    reviewers: ["code-reviewer", "security-reviewer"],
  },
];

// Precompile regexes and separate string matches for performance optimization.
// This prevents compiling RegExp objects on every file check in getReviewersForFile.
const COMPILED_MAPPINGS = REVIEWER_MAPPINGS.map((mapping) => {
  return {
    regexes: mapping.patterns
      .filter((p) => p.startsWith("\\."))
      .map((p) => new RegExp(p)),
    strings: mapping.patterns.filter((p) => !p.startsWith("\\.")),
    reviewers: mapping.reviewers,
  };
});

/**
 * Get reviewers for a single file based on its path
 */
export function getReviewersForFile(filePath: string): string[] {
  const defaultReviewers = ["code-reviewer"];
  const allReviewers = new Set<string>(defaultReviewers);

  for (const mapping of COMPILED_MAPPINGS) {
    if (
      mapping.strings.some((str) => filePath.includes(str)) ||
      mapping.regexes.some((regex) => regex.test(filePath))
    ) {
      for (const reviewer of mapping.reviewers) {
        allReviewers.add(reviewer);
      }
    }
  }

  return Array.from(allReviewers);
}

/**
 * Get unique reviewers for multiple files
 */
export function getReviewersForFiles(filePaths: string[]): string[] {
  const allReviewers = new Set<string>();

  for (const filePath of filePaths) {
    const reviewers = getReviewersForFile(filePath);
    for (const reviewer of reviewers) {
      allReviewers.add(reviewer);
    }
  }

  return Array.from(allReviewers);
}

/**
 * Check if a specific reviewer should review a file based on file path
 */
export function shouldReviewerReviewFile(
  filePath: string,
  reviewerName: string,
): boolean {
  const reviewersForFile = getReviewersForFile(filePath);
  return reviewersForFile.includes(reviewerName);
}
