# Reviewer Subagents Implementation

**Date:** 2026-04-11
**Status:** Approved

## Overview

Implement 5 specialized reviewer subagents (code-reviewer, database-reviewer, security-reviewer, go-reviewer, python-reviewer) as built-in subagents with automatic pre-commit invocation and explicit tool triggering.

## Architecture

### New Built-in Subagents

Five new reviewer agents will be added to `src/subagents/registry.ts`:

| Agent | Purpose | Model |
|-------|---------|-------|
| `code-reviewer` | General code quality, security, maintainability | sonnet |
| `database-reviewer` | PostgreSQL optimization, schema design, RLS | sonnet |
| `security-reviewer` | OWASP Top 10, vulnerabilities, secrets detection | sonnet |
| `go-reviewer` | Idiomatic Go, concurrency, error handling | sonnet |
| `python-reviewer` | PEP 8 compliance, Pythonic patterns, type hints | sonnet |

### Directory Structure

```
src/subagents/
├── registry.ts          # Add 5 new reviewer agents
├── toolFilter.ts        # Add reviewerTools
└── prompts/
    ├── codeReviewer.ts      # code-reviewer system prompt
    ├── databaseReviewer.ts  # database-reviewer system prompt
    ├── securityReviewer.ts  # security-reviewer system prompt
    ├── goReviewer.ts        # go-reviewer system prompt
    └── pythonReviewer.ts    # python-reviewer system prompt
```

### Invocation Mechanisms

**1. Pre-Commit Hook** (automatic)
- Modifies `commit_and_open_pr` tool
- Runs applicable reviewers before commit
- Blocks commit if CRITICAL issues found

**2. Explicit Tool** (`run_reviewers`)
- Standalone tool for on-demand review
- Auto-detects applicable reviewers from git diff
- Returns consolidated report

## Components

### 1. Reviewer Subagents

Each reviewer agent in `registry.ts`:
```typescript
{
  name: "code-reviewer",
  description: "Expert code review specialist. Proactively reviews code for quality, security, and maintainability.",
  systemPrompt: codeReviewerSystemPrompt,
  tools: reviewerTools,
  model: "sonnet"
}
```

### 2. Tool Filter

Add to `src/subagents/toolFilter.ts`:
```typescript
export const reviewerTools = filterToolsByName(
  ["code_search", "semantic_search"],
  ["sandbox_shell", "commit_and_open_pr", "merge_pr"]
);
```

### 3. Pre-Commit Hook

Modify `commit_and_open_pr` tool workflow:
1. Get staged files via `git diff --staged --name-only`
2. Map files → applicable reviewers
3. Run reviewers in parallel
4. Parse results → `ReviewIssue[]`
5. Block if CRITICAL issues, else proceed

### 4. run_reviewers Tool

New tool signature:
```typescript
{
  name: "run_reviewers",
  description: "Run reviewer agents against current changes",
  input: {
    reviewers?: string[],  // Optional: specific reviewers
    scope?: "staged" | "unstaged" | "all"  // Default: "staged"
  }
}
```

### 5. Review Result Parser

```typescript
interface ReviewIssue {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  file: string;
  line?: number;
  issue: string;
  fix: string;
}
```

## Data Flow

### Pre-Commit Flow

```
User: "Commit these changes"
  ↓
commit_and_open_pr tool
  ↓
[Pre-commit Hook]
  1. git diff --staged --name-only
  2. Map files → reviewers
  3. Parallel: createDeepAgent().invoke() for each
  4. Parse outputs → ReviewIssue[]
  5. If CRITICAL → block with error
  6. Else → proceed
  ↓
Commit created
```

### File Pattern to Reviewer Mapping

| File Pattern | Reviewers |
|--------------|-----------|
| `*.go` | code-reviewer, go-reviewer |
| `*.py` | code-reviewer, python-reviewer |
| `*.sql`, `*migration*`, `*schema*` | code-reviewer, database-reviewer |
| `*auth*`, `*login*`, `*password*`, API routes | code-reviewer, security-reviewer |
| All other files | code-reviewer |

## Error Handling

- **Reviewer failures**: Log warning, continue with other reviewers
- **All reviewers fail**: Proceed with commit (don't block on tool failure)
- **Parse failures**: Treat as warning, include raw output
- **User override**: `force: true` parameter in commit_and_open_pr tool input to bypass blocks (logged with warning)

## Testing

### Unit Tests

- File pattern → reviewer mapping
- Review result parser
- Commit blocking logic
- Force override

### Integration Tests

- Pre-commit hook with staged changes
- Parallel reviewer execution
- `run_reviewers` tool end-to-end

### Test Fixtures

- Sample files with intentional issues per reviewer type
- Mock reviewer responses

## Environment Variables

```bash
# Optional: Override default models
CODE_REVIEWER_MODEL=sonnet
DATABASE_REVIEWER_MODEL=sonnet
SECURITY_REVIEWER_MODEL=sonnet
GO_REVIEWER_MODEL=sonnet
PYTHON_REVIEWER_MODEL=sonnet

# Optional: Disable pre-commit reviews
REVIEWERS_PRE_COMMIT_ENABLED=true  # default
```

## Success Criteria

- [ ] All 5 reviewer agents defined in registry
- [ ] System prompts extracted from documentation to prompt files
- [ ] Pre-commit hook integrated into commit tool
- [ ] `run_reviewers` tool functional
- [ ] Tests pass (unit + integration)
- [ ] Documentation updated (AGENTS.md)
