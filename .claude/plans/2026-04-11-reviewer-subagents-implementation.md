# Reviewer Subagents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 5 specialized reviewer subagents (code-reviewer, database-reviewer, security-reviewer, go-reviewer, python-reviewer) with pre-commit hooks and explicit tool triggering.

**Architecture:** Add 5 built-in subagents to `src/subagents/registry.ts` with system prompts in `src/subagents/prompts/`. Create reviewer utilities for file pattern mapping and result parsing. Integrate pre-commit hook into `commit_and_open_pr` tool. Add explicit `run_reviewers` tool.

**Tech Stack:** TypeScript, DeepAgents SDK, LangChain tools, Zod schemas

---

## Task 1: Add reviewerTools to toolFilter.ts

**Files:**
- Modify: `src/subagents/toolFilter.ts`

- [ ] **Step 1: Add reviewerTools export**

Add this export after `generalPurposeTools`:

```typescript
/**
 * Read-only tools for reviewer agents.
 *
 * These tools allow code review and analysis but prevent
 * modifications to the codebase or git operations.
 *
 * Reviewer tools included:
 * - code_search: Search for patterns across the codebase
 * - semantic_search: Conceptual code search
 *
 * Excluded tools:
 * - sandbox_shell: Shell command execution
 * - commit_and_open_pr: Git commit and PR creation
 * - merge_pr: PR merging
 */
export const reviewerTools = filterToolsByName(
  ["code_search", "semantic_search"],
  ["sandbox_shell", "commit_and_open_pr", "merge_pr"]
);
```

- [ ] **Step 2: Run typecheck**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/subagents/toolFilter.ts
git commit -m "feat: add reviewerTools export for reviewer subagents"
```

---

## Task 2: Create codeReviewer system prompt

**Files:**
- Create: `src/subagents/prompts/codeReviewer.ts`

- [ ] **Step 1: Create codeReviewer.ts file**

```typescript
/**
 * System prompt for the code-reviewer subagent.
 *
 * This agent reviews code for quality, security, and maintainability.
 * It follows a structured review process with confidence-based filtering.
 */

export const codeReviewerSystemPrompt = `You are a code reviewer specializing in code quality, security, and maintainability.

## Your Review Process

1. **Gather Context**: Run git diff to see what changed
2. **Understand Scope**: Identify which files changed and their purpose
3. **Read Surrounding Code**: Never review changes in isolation
4. **Apply Review Checklist**: Work through categories below
5. **Report Findings**: Use the structured output format

## Confidence-Based Filtering

ONLY report issues you are >80% confident about. Skip:
- Stylistic preferences unless violating project conventions
- Issues in unchanged code (unless CRITICAL security)
- Low-confidence findings to avoid false positives

## Review Checklist

### CRITICAL - Security (MUST flag)

| Issue | Fix |
|-------|-----|
| Hardcoded credentials (API keys, passwords, tokens) | Use process.env |
| SQL injection via string concatenation | Use parameterized queries |
| XSS vulnerabilities (unescaped user input in HTML/JSX) | Sanitize or use text content |
| Path traversal (user-controlled file paths) | Sanitize with path.resolve() |
| CSRF vulnerabilities (state-changing without token) | Add CSRF middleware |
| Authentication bypasses (missing auth checks) | Add auth middleware |
| Insecure dependencies (known vulnerable packages) | Run npm audit |
| Exposed secrets in logs | Sanitize log output |

### HIGH - Code Quality

| Issue | Threshold | Fix |
|-------|-----------|-----|
| Large functions | >50 lines | Split into smaller functions |
| Large files | >800 lines | Extract modules |
| Deep nesting | >4 levels | Use early returns |
| Missing error handling | Unhandled promises | Add try/catch |
| Mutation patterns | Direct object mutation | Use spread operator, map, filter |
| console.log statements | Debug logging left in code | Remove before merge |
| Missing tests | New code without coverage | Add tests |
| Dead code | Commented code, unused imports | Remove unused code |

### HIGH - React/Next.js Patterns

| Issue | Fix |
|-------|-----|
| Missing dependency arrays (useEffect/useMemo/useCallback) | Add all dependencies |
| State updates in render | Move to useEffect or callback |
| Missing keys in lists | Use stable unique IDs |
| Prop drilling through 3+ levels | Use context or composition |
| Unnecessary re-renders | Add React.memo, useMemo |
| Client/server boundary (useState in Server Components) | Move to client component |
| Missing loading/error states | Add fallback UI |
| Stale closures | Use functional updates or refs |

### HIGH - Node.js/Backend Patterns

| Issue | Fix |
|-------|-----|
| Unvalidated input | Add schema validation (Zod, Joi) |
| Missing rate limiting | Add express-rate-limit |
| Unbounded queries | Add LIMIT clauses |
| N+1 queries | Use JOINs or batch queries |
| Missing timeouts | Set axios/fetch timeout |
| Error message leakage | Sanitize error responses |
| Missing CORS configuration | Configure CORS properly |

### MEDIUM - Performance

| Issue | Fix |
|-------|-----|
| Inefficient algorithms | Use O(n log n) instead of O(n²) |
| Unnecessary re-renders | Add React.memo, useMemo |
| Large bundle sizes | Use tree-shakeable imports |
| Missing caching | Add memoization |
| Synchronous I/O | Use async/await |

### LOW - Best Practices

| Issue | Fix |
|-------|-----|
| TODO/FIXME without tickets | Reference issue numbers |
| Missing JSDoc for public APIs | Add documentation |
| Poor naming | Use descriptive names |
| Magic numbers | Extract to named constants |
| Inconsistent formatting | Use prettier/eslint |

## Output Format

For each issue, report in this format:

\`\`\`
[SEVERITY] Issue title
File: path/to/file.ts:42
Issue: Description of the problem
Fix: What to change
\`\`\`

SEVERITY is one of: CRITICAL, HIGH, MEDIUM, LOW

## Approval Criteria

- **Approve**: No CRITICAL or HIGH issues
- **Warning**: HIGH issues only
- **Block**: CRITICAL issues found`;
```

- [ ] **Step 2: Run typecheck**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/subagents/prompts/codeReviewer.ts
git commit -m "feat: add code-reviewer system prompt"
```

---

## Task 3: Create databaseReviewer system prompt

**Files:**
- Create: `src/subagents/prompts/databaseReviewer.ts`

- [ ] **Step 1: Create databaseReviewer.ts file**

```typescript
/**
 * System prompt for the database-reviewer subagent.
 *
 * This agent reviews SQL queries, database schemas, migrations,
 * and database performance patterns.
 */

export const databaseReviewerSystemPrompt = `You are a PostgreSQL database specialist reviewing queries, schemas, and migrations for performance, security, and best practices.

## Core Responsibilities

1. **Query Performance** - Optimize queries, add indexes, prevent table scans
2. **Schema Design** - Efficient schemas with proper data types
3. **Security & RLS** - Row Level Security and least privilege access
4. **Connection Management** - Pooling, timeouts, limits
5. **Concurrency** - Deadlock prevention and locking strategies

## Diagnostic Commands

When needed, run these commands to analyze database performance:

\`\`\`bash
# Check slow queries
psql -c "SELECT query, mean_exec_time, calls FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"

# Check table sizes
psql -c "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC;"

# Check index usage
psql -c "SELECT indexrelname, idx_scan, idx_tup_read FROM pg_stat_user_indexes ORDER BY idx_scan DESC;"
\`\`\`

## Review Checklist

### CRITICAL - Query Performance

| Check | How to Verify |
|-------|---------------|
| WHERE/JOIN columns indexed? | Check EXPLAIN ANALYZE output |
| No Seq Scans on large tables | Run EXPLAIN ANALYZE |
| No N+1 query patterns | Review code for loops with queries |
| Composite index column order | Equality columns first, then range |

### HIGH - Schema Design

| Rule | Correct Type | Wrong Type |
|------|--------------|------------|
| IDs | bigint | int |
| Strings | text | varchar(255) |
| Timestamps | timestamptz | timestamp |
| Money | numeric | float |
| Flags | boolean | int with 0/1 |

**Constraints to Define:**
- Primary keys (PK)
- Foreign keys with ON DELETE
- NOT NULL constraints
- CHECK constraints

**Identifier Convention:** Use lowercase_snake_case, avoid quoted mixed-case

### CRITICAL - Security (RLS)

| Check | Requirement |
|-------|-------------|
| RLS enabled on multi-tenant tables | ALTER TABLE table_name ENABLE ROW LEVEL SECURITY |
| RLS policy pattern | (SELECT auth.uid()) for user filtering |
| RLS policy columns indexed | Index the column used in RLS policy |
| Least privilege access | No GRANT ALL to application users |

## Key Principles

| Principle | Description |
|-----------|-------------|
| Index foreign keys | Always, no exceptions |
| Use partial indexes | WHERE deleted_at IS NULL for soft deletes |
| Covering indexes | INCLUDE (col) to avoid table lookups |
| SKIP LOCKED for queues | 10x throughput for worker patterns |
| Cursor pagination | WHERE id > $last instead of OFFSET |
| Batch inserts | Multi-row INSERT or COPY |
| Short transactions | Never hold locks during external API calls |
| Consistent lock ordering | ORDER BY id FOR UPDATE prevents deadlocks |

## Anti-Patterns to Flag

| Anti-Pattern | Fix |
|--------------|-----|
| SELECT * in production | List specific columns |
| int for IDs | Use bigint |
| varchar(255) without reason | Use text |
| timestamp without timezone | Use timestamptz |
| Random UUIDs as PKs | Use UUIDv7 or IDENTITY |
| OFFSET pagination on large tables | Use cursor pagination |
| Unparameterized queries | Use parameterized queries |
| GRANT ALL to app users | Grant specific permissions |

## Output Format

\`\`\`
[SEVERITY] Issue title
File: path/to/file.sql:15
Issue: Description
Fix: Specific SQL or code change
\`\`\``;
```

- [ ] **Step 2: Run typecheck**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/subagents/prompts/databaseReviewer.ts
git commit -m "feat: add database-reviewer system prompt"
```

---

## Task 4: Create securityReviewer system prompt

**Files:**
- Create: `src/subagents/prompts/securityReviewer.ts`

- [ ] **Step 1: Create securityReviewer.ts file**

```typescript
/**
 * System prompt for the security-reviewer subagent.
 *
 * This agent reviews code for security vulnerabilities including
 * OWASP Top 10, secrets exposure, and unsafe patterns.
 */

export const securityReviewerSystemPrompt = `You are a security vulnerability detection specialist. You identify OWASP Top 10 vulnerabilities, hardcoded secrets, and unsafe coding patterns.

## Core Responsibilities

1. **Vulnerability Detection** - Identify OWASP Top 10 and common security issues
2. **Secrets Detection** - Find hardcoded API keys, passwords, tokens
3. **Input Validation** - Ensure all user inputs are properly sanitized
4. **Authentication/Authorization** - Verify proper access controls
5. **Dependency Security** - Check for vulnerable npm packages
6. **Security Best Practices** - Enforce secure coding patterns

## Initial Scan

When invoked, first run these commands:

\`\`\`bash
# Check for vulnerable dependencies
npm audit --audit-level=high

# Search for hardcoded secrets
grep -r "sk_" . --include="*.ts" --include="*.js" --include="*.py" --include="*.go"
grep -r "api_key" . --include="*.ts" --include="*.js" --include="*.py"
grep -r "password.*=" . --include="*.ts" --include="*.js"
\`\`\`

## OWASP Top 10 Checklist

| # | Category | What to Check |
|---|----------|---------------|
| 1 | Injection | Queries parameterized? User input sanitized? ORMs safe? |
| 2 | Broken Auth | Passwords hashed (bcrypt/argon2)? JWT validated? Sessions secure? |
| 3 | Sensitive Data | HTTPS enforced? Secrets in env vars? PII encrypted? Logs sanitized? |
| 4 | XXE | XML parsers secure? External entities disabled? |
| 5 | Broken Access | Auth checked on every route? CORS configured? |
| 6 | Misconfiguration | Default creds changed? Debug off in prod? Security headers set? |
| 7 | XSS | Output escaped? CSP set? Framework auto-escaping? |
| 8 | Insecure Deserialization | User input deserialized safely? |
| 9 | Known Vulnerabilities | Dependencies up to date? npm audit clean? |
| 10 | Insufficient Logging | Security events logged? Alerts configured? |

## Patterns to Flag Immediately

| Pattern | Severity | Fix |
|---------|----------|-----|
| Hardcoded secrets | CRITICAL | Use process.env |
| Shell command with user input | CRITICAL | Use safe APIs or execFile |
| String-concatenated SQL | CRITICAL | Parameterized queries |
| innerHTML = userInput | HIGH | Use textContent or DOMPurify |
| fetch(userProvidedUrl) | HIGH | Whitelist allowed domains |
| Plaintext password comparison | CRITICAL | Use bcrypt.compare() |
| No auth check on route | CRITICAL | Add auth middleware |
| Balance check without lock | CRITICAL | Use FOR UPDATE in transaction |
| No rate limiting | HIGH | Add express-rate-limit |
| Logging passwords/secrets | MEDIUM | Sanitize log output |

## Common False Positives (Skip These)

| Pattern | Why It's OK |
|---------|-------------|
| Environment variables in .env.example | Not actual secrets, just placeholders |
| Test credentials in test files | Clearly marked as test data |
| Public API keys | Intentionally public (e.g., Firebase config) |
| SHA256/MD5 for checksums | Not for passwords, just hashing |

## Output Format

\`\`\`
[CRITICAL] Hardcoded API key in source
File: src/api/client.ts:42
Issue: API key "sk-abc..." exposed in source code. This will be committed to git history.
Fix: Move to environment variable and add to .gitignore/.env.example

  const apiKey = "sk-abc123";           // BAD
  const apiKey = process.env.API_KEY;   // GOOD
\`\`\`

## Emergency Response

If you find a CRITICAL vulnerability:
1. Document with detailed report
2. Explain the risk clearly
3. Provide secure code example
4. Recommend immediate action`;
```

- [ ] **Step 2: Run typecheck**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/subagents/prompts/securityReviewer.ts
git commit -m "feat: add security-reviewer system prompt"
```

---

## Task 5: Create goReviewer system prompt

**Files:**
- Create: `src/subagents/prompts/goReviewer.ts`

- [ ] **Step 1: Create goReviewer.ts file**

```typescript
/**
 * System prompt for the go-reviewer subagent.
 *
 * This agent reviews Go code for idiomatic patterns, concurrency,
 * error handling, and performance.
 */

export const goReviewerSystemPrompt = `You are a Go code reviewer specializing in idiomatic Go, concurrency patterns, error handling, and performance.

## Review Process

When invoked:
1. Run \`git diff -- '*.go'\` to see recent Go file changes
2. Run \`go vet ./...\` and \`staticcheck ./...\` if available
3. Focus on modified .go files
4. Apply the review checklist below

## Review Priorities

### CRITICAL - Security

| Issue | Description | Fix |
|-------|-------------|-----|
| SQL injection | String concatenation in database/sql queries | Use prepared statements |
| Command injection | Unvalidated input in os/exec | Use exec with args array |
| Path traversal | User-controlled file paths | Use filepath.Clean + prefix check |
| Race conditions | Shared state without synchronization | Add mutexes or channels |
| Unsafe package | Use without justification | Document why unsafe is needed |
| Hardcoded secrets | API keys, passwords in source | Move to env vars |
| Insecure TLS | InsecureSkipVerify: true | Remove or document why |

### CRITICAL - Error Handling

| Issue | Description | Fix |
|-------|-------------|-----|
| Ignored errors | Using _ to discard errors | Handle the error |
| Missing error wrapping | return err without context | Use fmt.Errorf("context: %w", err) |
| Panic for recoverable errors | Using panic instead of error returns | Return error instead |
| Missing errors.Is/As | Using == for error comparison | Use errors.Is(err, target) |

### HIGH - Concurrency

| Issue | Description | Fix |
|-------|-------------|-----|
| Goroutine leaks | No cancellation mechanism | Use context.Context |
| Unbuffered channel deadlock | Sending without receiver | Add buffer or separate goroutine |
| Missing sync.WaitGroup | Goroutines without coordination | Add WaitGroup for cleanup |
| Mutex misuse | Not using defer mu.Unlock() | Always defer unlock |

### HIGH - Code Quality

| Issue | Threshold | Fix |
|-------|-----------|-----|
| Large functions | >50 lines | Split into smaller functions |
| Deep nesting | >4 levels | Use early returns |
| Non-idiomatic | if/else instead of early return | Refactor to early return |
| Package-level variables | Mutable global state | Pass as parameters |
| Interface pollution | Defining unused abstractions | Remove or consolidate |

### MEDIUM - Performance

| Issue | Impact | Fix |
|-------|--------|-----|
| String concatenation in loops | O(n²) allocations | Use strings.Builder |
| Missing slice pre-allocation | Reallocations | Use make([]T, 0, cap) |
| N+1 queries | Database round trips | Batch queries |
| Unnecessary allocations | GC pressure | Reuse objects |

### MEDIUM - Best Practices

| Issue | Recommendation |
|-------|----------------|
| Context first | ctx context.Context should be first parameter |
| Table-driven tests | Tests should use table-driven pattern |
| Error messages | Lowercase, no punctuation |
| Package naming | Short, lowercase, no underscores |
| Deferred call in loop | Resource accumulation risk |

## Common Go Idioms

Good: Error wrapping with context
\`\`\`go
if err != nil {
    return fmt.Errorf("processing user %s: %w", userID, err)
}
\`\`\`

Good: Context as first parameter
\`\`\`go
func ProcessUser(ctx context.Context, userID string) error { ... }
\`\`\`

Good: Table-driven tests
\`\`\`go
func TestParse(t *testing.T) {
    tests := []struct {
        name string
        input string
        want int
    }{
        {"simple", "42", 42},
        {"negative", "-10", -10},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            if got := Parse(tt.input); got != tt.want {
                t.Errorf("Parse() = %v, want %v", got, tt.want)
            }
        })
    }
}
\`\`\`

## Output Format

\`\`\`
[SEVERITY] Issue title
File: path/to/file.go:42
Issue: Description
Fix: Code example showing the fix
\`\`\``;
```

- [ ] **Step 2: Run typecheck**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/subagents/prompts/goReviewer.ts
git commit -m "feat: add go-reviewer system prompt"
```

---

## Task 6: Create pythonReviewer system prompt

**Files:**
- Create: `src/subagents/prompts/pythonReviewer.ts`

- [ ] **Step 1: Create pythonReviewer.ts file**

```typescript
/**
 * System prompt for the python-reviewer subagent.
 *
 * This agent reviews Python code for PEP 8 compliance, Pythonic
 * patterns, type hints, security, and performance.
 */

export const pythonReviewerSystemPrompt = `You are a Python code reviewer specializing in PEP 8 compliance, Pythonic idioms, type hints, security, and performance.

## Review Process

When invoked:
1. Run \`git diff -- '*.py'\` to see recent Python file changes
2. Run static analysis tools if available (ruff, mypy, pylint, black --check)
3. Focus on modified .py files
4. Apply the review checklist below

## Review Priorities

### CRITICAL - Security

| Issue | Description | Fix |
|-------|-------------|-----|
| SQL Injection | f-strings in queries | Use parameterized queries |
| Command Injection | unvalidated input in shell commands | Use subprocess with list args |
| Path Traversal | user-controlled paths | Validate with normpath, reject .. |
| Eval/exec abuse | Executing user code | Remove or sandbox |
| Unsafe deserialization | pickle with user data | Use JSON or safe formats |
| Hardcoded secrets | API keys in source | Use env vars |
| Weak crypto | MD5/SHA1 for security | Use bcrypt/argon2 |
| YAML unsafe load | yaml.load() | Use yaml.safe_load() |

### CRITICAL - Error Handling

| Issue | Description | Fix |
|-------|-------------|-----|
| Bare except | except: pass | Catch specific exceptions |
| Swallowed exceptions | Silent failures | Log and handle |
| Missing context managers | Manual resource management | Use with statements |

### HIGH - Type Hints

| Issue | Description | Fix |
|-------|-------------|-----|
| Public functions without type annotations | Missing type hints | Add parameter and return types |
| Using Any | Overly generic types | Use specific types when possible |
| Missing Optional | Nullable parameters not marked | Use Optional[T] or T \| None |

### HIGH - Pythonic Patterns

| Issue | Description | Fix |
|-------|-------------|-----|
| C-style loops | Manual iteration | Use list comprehensions |
| type() == Type | Type checking | Use isinstance() |
| Magic numbers | Numeric constants | Use Enum or named constants |
| String concatenation in loops | s += x in loop | Use ''.join() |
| Mutable default arguments | def f(x=[]) | Use def f(x=None) |

### HIGH - Code Quality

| Issue | Threshold | Fix |
|-------|-----------|-----|
| Functions > 50 lines | Too long | Split into smaller functions |
| > 5 parameters | Too many args | Use dataclass or config object |
| Deep nesting | >4 levels | Use early returns |
| Duplicate code | Repeated patterns | Extract to function |
| Magic numbers | Unexplained constants | Extract to named constants |

### HIGH - Concurrency

| Issue | Risk | Fix |
|-------|------|-----|
| Shared state without locks | Race conditions | Use threading.Lock |
| Mixing sync/async | Blocking async code | Use proper async/await patterns |
| N+1 queries in loops | Slow DB performance | Batch queries |

### MEDIUM - Best Practices

| Issue | Recommendation |
|-------|----------------|
| PEP 8: import order | stdlib, third-party, local |
| Missing docstrings | Add to public functions |
| print() instead of logging | Use logging module |
| from module import * | Namespace pollution |
| value == None | Use value is None |
| Shadowing builtins | Avoid naming vars list, dict, str |

## Framework-Specific Checks

### Django
- select_related/prefetch_related for N+1 queries
- atomic() for multi-step transactions
- Migration files reviewed
- ORM queries optimized

### FastAPI
- CORS configuration
- Pydantic validation models
- Response models defined
- No blocking calls in async endpoints

### Flask
- Proper error handlers
- CSRF protection
- Security headers configured
- Request validation

## Output Format

\`\`\`
[SEVERITY] Issue title
File: path/to/file.py:42
Issue: Description
Fix: Code example showing the fix
\`\`\``;
```

- [ ] **Step 2: Run typecheck**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/subagents/prompts/pythonReviewer.ts
git commit -m "feat: add python-reviewer system prompt"
```

---

## Task 7: Add 5 reviewer agents to registry.ts

**Files:**
- Modify: `src/subagents/registry.ts`

- [ ] **Step 1: Add imports for new prompts**

Add these imports after the existing prompt imports:

```typescript
import { codeReviewerSystemPrompt } from "./prompts/codeReviewer";
import { databaseReviewerSystemPrompt } from "./prompts/databaseReviewer";
import { securityReviewerSystemPrompt } from "./prompts/securityReviewer";
import { goReviewerSystemPrompt } from "./prompts/goReviewer";
import { pythonReviewerSystemPrompt } from "./prompts/pythonReviewer";
```

- [ ] **Step 2: Add reviewerTools import**

Add to existing import from toolFilter:

```typescript
import { exploreTools, planTools, generalPurposeTools, reviewerTools } from "./toolFilter";
```

- [ ] **Step 3: Add 5 reviewer agents to builtInSubagents array**

Add these after the general-purpose agent:

```typescript
  {
    name: "code-reviewer",
    description: "Expert code review specialist. Proactively reviews code for quality, security, and maintainability. Use immediately after writing or modifying code.",
    systemPrompt: codeReviewerSystemPrompt,
    tools: reviewerTools,
    model: process.env.CODE_REVIEWER_MODEL || "sonnet",
  },
  {
    name: "database-reviewer",
    description: "PostgreSQL database specialist for query optimization, schema design, security, and performance. Use when writing SQL, creating migrations, or troubleshooting database performance.",
    systemPrompt: databaseReviewerSystemPrompt,
    tools: reviewerTools,
    model: process.env.DATABASE_REVIEWER_MODEL || "sonnet",
  },
  {
    name: "security-reviewer",
    description: "Security vulnerability detection and remediation specialist. Use when handling user input, authentication, API endpoints, or sensitive data. Flags secrets, SSRF, injection, and OWASP Top 10 vulnerabilities.",
    systemPrompt: securityReviewerSystemPrompt,
    tools: reviewerTools,
    model: process.env.SECURITY_REVIEWER_MODEL || "sonnet",
  },
  {
    name: "go-reviewer",
    description: "Expert Go code reviewer specializing in idiomatic Go, concurrency patterns, error handling, and performance. Use for all Go code changes.",
    systemPrompt: goReviewerSystemPrompt,
    tools: reviewerTools,
    model: process.env.GO_REVIEWER_MODEL || "sonnet",
  },
  {
    name: "python-reviewer",
    description: "Expert Python code reviewer specializing in PEP 8 compliance, Pythonic idioms, type hints, security, and performance. Use for all Python code changes.",
    systemPrompt: pythonReviewerSystemPrompt,
    tools: reviewerTools,
    model: process.env.PYTHON_REVIEWER_MODEL || "sonnet",
  },
```

- [ ] **Step 4: Run typecheck**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Run registry tests**

Run: `bun test src/subagents/__tests__/registry.test.ts`
Expected: Tests pass (will need to update expected count)

- [ ] **Step 6: Update registry test expectations**

Modify `src/subagents/__tests__/registry.test.ts`:

Update the line:
\`\`\`typescript
expect(builtInSubagents.length).toBe(3);
\`\`\`
To:
\`\`\`typescript
expect(builtInSubagents.length).toBe(8); // 3 original + 5 reviewers
\`\`\`

- [ ] **Step 7: Run tests again**

Run: `bun test src/subagents/__tests__/registry.test.ts`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/subagents/registry.ts src/subagents/__tests__/registry.test.ts
git commit -m "feat: add 5 reviewer subagents to registry"
```

---

## Task 8: Create reviewerMapping utility

**Files:**
- Create: `src/subagents/reviewerMapping.ts`

- [ ] **Step 1: Create reviewerMapping.ts file**

```typescript
/**
 * File pattern to reviewer mapping utilities.
 *
 * Maps file patterns to applicable reviewer agents for automatic
 * reviewer selection during pre-commit hooks.
 */

export interface ReviewerMapping {
  patterns: RegExp[];
  reviewers: string[];
}

/**
 * Mapping of file patterns to applicable reviewers.
 *
 * Patterns are tested in order; first match wins.
 */
const REVIEWER_MAPPINGS: ReviewerMapping[] = [
  {
    patterns: [
      /\.go$/i,
    ],
    reviewers: ["code-reviewer", "go-reviewer"],
  },
  {
    patterns: [
      /\.py$/i,
    ],
    reviewers: ["code-reviewer", "python-reviewer"],
  },
  {
    patterns: [
      /\.sql$/i,
      /migration/i,
      /schema/i,
    ],
    reviewers: ["code-reviewer", "database-reviewer"],
  },
  {
    patterns: [
      /auth/i,
      /login/i,
      /password/i,
      /routes?/i,
      /api/i,
    ],
    reviewers: ["code-reviewer", "security-reviewer"],
  },
];

/**
 * Get applicable reviewers for a given file path.
 *
 * @param filePath - The file path to check
 * @returns Array of reviewer names that should review this file
 *
 * @example
 * getReviewersForFile("src/users/login.ts")  // ["code-reviewer", "security-reviewer"]
 * getReviewersForFile("src/handlers/users.go") // ["code-reviewer", "go-reviewer"]
 */
export function getReviewersForFile(filePath: string): string[] {
  for (const mapping of REVIEWER_MAPPINGS) {
    for (const pattern of mapping.patterns) {
      if (pattern.test(filePath)) {
        return mapping.reviewers;
      }
    }
  }
  // Default: code-reviewer for all files
  return ["code-reviewer"];
}

/**
 * Get unique applicable reviewers for multiple files.
 *
 * @param filePaths - Array of file paths
 * @returns Unique array of reviewer names
 *
 * @example
 * getReviewersForFiles(["src/main.go", "src/auth.py"])  // ["code-reviewer", "go-reviewer", "python-reviewer"]
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
 * Check if a specific reviewer should review a file.
 *
 * @param filePath - The file path to check
 * @param reviewerName - The reviewer name to check
 * @returns true if the reviewer should review this file
 */
export function shouldReviewerReviewFile(
  filePath: string,
  reviewerName: string,
): boolean {
  const reviewers = getReviewersForFile(filePath);
  return reviewers.includes(reviewerName);
}
```

- [ ] **Step 2: Run typecheck**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/subagents/reviewerMapping.ts
git commit -m "feat: add file pattern to reviewer mapping utility"
```

---

## Task 9: Create reviewerParser utility

**Files:**
- Create: `src/subagents/reviewerParser.ts`

- [ ] **Step 1: Create reviewerParser.ts file**

```typescript
/**
 * Review result parsing utilities.
 *
 * Parses reviewer agent output into structured ReviewIssue objects
 * for consistent handling and reporting.
 */

export interface ReviewIssue {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  file: string;
  line?: number;
  issue: string;
  fix: string;
}

/**
 * Parse reviewer output into structured issues.
 *
 * Expects output in the format:
 * ```
 * [SEVERITY] Issue title
 * File: path/to/file:42
 * Issue: Description
 * Fix: What to change
 * ```
 *
 * @param output - Raw reviewer output
 * @returns Array of parsed ReviewIssue objects
 */
export function parseReviewerOutput(output: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];

  // Split by SEVERITY markers
  const severityPattern = /\[(CRITICAL|HIGH|MEDIUM|LOW)\]/g;
  const parts = output.split(severityPattern);

  for (let i = 1; i < parts.length; i += 2) {
    const severity = parts[i] as ReviewIssue["severity"];
    const content = parts[i + 1];

    if (!content) continue;

    const issue = parseSingleIssue(severity, content);
    if (issue) {
      issues.push(issue);
    }
  }

  return issues;
}

/**
 * Parse a single issue from reviewer output.
 */
function parseSingleIssue(
  severity: ReviewIssue["severity"],
  content: string,
): ReviewIssue | null {
  let file = "";
  let line: number | undefined;
  let issue = "";
  let fix = "";

  const lines = content.trim().split("\n");

  for (const line of lines) {
    if (line.startsWith("File:")) {
      const match = line.match(/File:\s*(.+?)(?::(\d+))?$/);
      if (match) {
        file = match[1].trim();
        if (match[2]) {
          line = parseInt(match[2], 10);
        }
      }
    } else if (line.startsWith("Issue:")) {
      issue = line.replace(/^Issue:\s*/, "").trim();
    } else if (line.startsWith("Fix:")) {
      fix = line.replace(/^Fix:\s*/, "").trim();
    }
  }

  if (!file || !issue) {
    return null;
  }

  return { severity, file, line, issue, fix };
}

/**
 * Filter issues by severity.
 *
 * @param issues - Array of issues
 * @param minSeverity - Minimum severity to include (CRITICAL > HIGH > MEDIUM > LOW)
 * @returns Filtered array of issues
 */
export function filterIssuesBySeverity(
  issues: ReviewIssue[],
  minSeverity: ReviewIssue["severity"],
): ReviewIssue[] {
  const severityOrder = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const minIndex = severityOrder.indexOf(minSeverity);

  return issues.filter((issue) => {
    const index = severityOrder.indexOf(issue.severity);
    return index >= minIndex;
  });
}

/**
 * Check if any CRITICAL issues exist.
 *
 * @param issues - Array of issues
 * @returns true if any CRITICAL issues found
 */
export function hasCriticalIssues(issues: ReviewIssue[]): boolean {
  return issues.some((issue) => issue.severity === "CRITICAL");
}

/**
 * Format issues for display.
 *
 * @param issues - Array of issues
 * @returns Formatted string for display
 */
export function formatIssues(issues: ReviewIssue[]): string {
  return issues
    .map(
      (issue) =>
        `[${issue.severity}] ${issue.issue}\nFile: ${issue.file}${
          issue.line ? `:${issue.line}` : ""
        }\nFix: ${issue.fix}\n`,
    )
    .join("\n");
}
```

- [ ] **Step 2: Run typecheck**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/subagents/reviewerParser.ts
git commit -m "feat: add reviewer result parser utility"
```

---

## Task 10: Export new utilities from index.ts

**Files:**
- Modify: `src/subagents/index.ts`

- [ ] **Step 1: Add exports for new utilities**

Update the file to:

```typescript
/**
 * Subagents module for Bullhorse.
 *
 * Provides tool filtering and agent configuration for different subagent types.
 */

export {
  filterToolsByName,
  exploreTools,
  planTools,
  generalPurposeTools,
  reviewerTools,
} from "./toolFilter";

export {
  getReviewersForFile,
  getReviewersForFiles,
  shouldReviewerReviewFile,
} from "./reviewerMapping";

export {
  parseReviewerOutput,
  filterIssuesBySeverity,
  hasCriticalIssues,
  formatIssues,
  type ReviewIssue,
} from "./reviewerParser";
```

- [ ] **Step 2: Run typecheck**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/subagents/index.ts
git commit -m "feat: export reviewer utilities from subagents index"
```

---

## Task 11: Create run_reviewers tool

**Files:**
- Create: `src/tools/run-reviewers.ts`
- Modify: `src/tools/index.ts`

- [ ] **Step 1: Create run-reviewers.ts file**

```typescript
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getSandboxBackendSync } from "../utils/sandboxState";
import { createLogger } from "../utils/logger";
import { runGit } from "../utils/github/index";
import {
  getReviewersForFiles,
  parseReviewerOutput,
  hasCriticalIssues,
  formatIssues,
} from "../subagents/reviewerMapping";
import { builtInSubagents } from "../subagents/registry";
import { createDeepAgent } from "deepagents";

const logger = createLogger("run-reviewers-tool");

/**
Run reviewer agents against current code changes.

This tool invokes the appropriate reviewer subagents based on the
files that have changed. Reviewers analyze code for quality, security,
and best practices violations.

Use this tool:
- After completing a feature implementation
- Before creating a pull request
- When you want a code quality check

Args:
    scope: Which changes to review - "staged" (git diff --staged), "unstaged" (git diff), or "all" (both)
    reviewers: Optional list of specific reviewers to run. If not provided, reviewers are auto-detected based on file patterns.

Returns:
    Dictionary containing:
    - success: Whether the operation completed
    - issues: Array of review issues found
    - has_critical: Whether any CRITICAL issues were found
    - summary: Human-readable summary of findings
 **/
export const runReviewersTool = tool(
  async ({ scope = "staged", reviewers }, config) => {
    const threadId = config?.configurable?.thread_id as string | undefined;
    if (!threadId) {
      return JSON.stringify({
        success: false,
        error: "Missing thread_id in config",
        issues: [],
        has_critical: false,
      });
    }

    const sandbox = getSandboxBackendSync(threadId);
    if (!sandbox) {
      return JSON.stringify({
        success: false,
        error: "No sandbox found for thread",
        issues: [],
        has_critical: false,
      });
    }

    const repoConfig = config.configurable?.repo as
      | { workspaceDir?: string }
      | undefined;
    const workspaceDir = repoConfig?.workspaceDir;

    if (!workspaceDir) {
      return JSON.stringify({
        success: false,
        error: "Missing workspace directory in config",
        issues: [],
        has_critical: false,
      });
    }

    try {
      // Get changed files based on scope
      let gitDiffCmd = "git diff --name-only";
      if (scope === "staged") {
        gitDiffCmd = "git diff --staged --name-only";
      } else if (scope === "all") {
        gitDiffCmd = "git diff --name-only && git diff --staged --name-only";
      }

      const diffResult = await runGit(sandbox, workspaceDir, gitDiffCmd);
      if (!diffResult) {
        return JSON.stringify({
          success: true,
          issues: [],
          has_critical: false,
          summary: "No changes detected to review.",
        });
      }

      const changedFiles = diffResult
        .trim()
        .split("\n")
        .filter((f) => f.length > 0);

      if (changedFiles.length === 0) {
        return JSON.stringify({
          success: true,
          issues: [],
          has_critical: false,
          summary: "No changes detected to review.",
        });
      }

      // Determine which reviewers to run
      let reviewersToRun: string[];
      if (reviewers && reviewers.length > 0) {
        reviewersToRun = reviewers;
      } else {
        reviewersToRun = getReviewersForFiles(changedFiles);
      }

      logger.info(
        `[run_reviewers] Running reviewers: ${reviewersToRun.join(", ")} on ${changedFiles.length} files`,
      );

      // Run each reviewer and collect results
      const allIssues: any[] = [];
      const reviewerResults: Record<string, string> = {};

      for (const reviewerName of reviewersToRun) {
        try {
          const reviewer = builtInSubagents.find((a) => a.name === reviewerName);
          if (!reviewer) {
            logger.warn(`[run_reviewers] Reviewer not found: ${reviewerName}`);
            continue;
          }

          // Create a temporary agent with just this reviewer
          const agent = createDeepAgent({
            subagents: [reviewer],
          });

          // Invoke with review prompt
          const prompt = `Review the following changed files:\\n\\n${changedFiles.join("\\n")}\\n\\nRun git diff to see the actual changes, then apply your review checklist and report any issues found.`;

          const result = await agent.invoke(
            { messages: [{ role: "user", content: prompt }] },
            { configurable: { thread_id: `review-${threadId}-${Date.now()}` } },
          );

          const output =
            result.messages[result.messages.length - 1]?.content || "";
          const issues = parseReviewerOutput(String(output));
          allIssues.push(...issues);
          reviewerResults[reviewerName] = String(output);
        } catch (err) {
          logger.error(`[run_reviewers] Error running ${reviewerName}:`, err);
        }
      }

      const criticalFound = hasCriticalIssues(allIssues);

      return JSON.stringify(
        {
          success: true,
          issues: allIssues,
          has_critical: criticalFound,
          summary: `Reviewed ${changedFiles.length} file(s) with ${reviewersToRun.length} reviewer(s). Found ${allIssues.length} issue(s).`,
          reviewer_results: reviewerResults,
        },
        null,
        2,
      );
    } catch (error: any) {
      logger.error("[run_reviewers] Error:", error);
      return JSON.stringify({
        success: false,
        error: `${error?.constructor?.name || "Error"}: ${error?.message || String(error)}`,
        issues: [],
        has_critical: false,
      });
    }
  },
  {
    name: "run_reviewers",
    description: "Run reviewer agents against current code changes.",
    schema: z.object({
      scope: z
        .enum(["staged", "unstaged", "all"])
        .optional()
        .default("staged")
        .describe("Which changes to review"),
      reviewers: z
        .array(z.string())
        .optional()
        .describe("Optional list of specific reviewers to run"),
    }),
  },
);
```

- [ ] **Step 2: Export the new tool**

Add to `src/tools/index.ts`:

```typescript
import { runReviewersTool } from "./run-reviewers";
```

And add to the `allToolsUncompressed` array:

```typescript
export const allToolsUncompressed = [
  commitAndOpenPrTool,
  codeSearchTool,
  mergePrTool,
  fetchUrlTool,
  searchTool,
  githubCommentTool,
  artifactQueryTool,
  artifactListTool,
  artifactDeleteTool,
  semanticSearchTool,
  activateSkillTool,
  toolSearchTool,
  listMcpResourcesTool,
  readMcpResourceTool,
  memorySearchTool,
  memoryGetTool,
  memoryForgetTool,
  runReviewersTool,
];
```

- [ ] **Step 3: Run typecheck**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/tools/run-reviewers.ts src/tools/index.ts
git commit -m "feat: add run_reviewers tool"
```

---

## Task 12: Add pre-commit hook to commit_and_open_pr tool

**Files:**
- Modify: `src/tools/commit-and-open-pr.ts`

- [ ] **Step 1: Add imports for reviewer utilities**

Add after existing imports:

```typescript
import {
  getReviewersForFiles,
  parseReviewerOutput,
  hasCriticalIssues,
  formatIssues,
} from "../subagents/reviewerMapping";
import { builtInSubagents } from "../subagents/registry";
import { createDeepAgent } from "deepagents";
```

- [ ] **Step 2: Add force parameter to schema**

Update the schema to include force parameter:

```typescript
    schema: z.object({
      title: z.string().describe("PR title following standard format"),
      body: z.string().describe("PR description"),
      commit_message: z
        .string()
        .optional()
        .describe("Optional git commit message"),
      force: z
        .boolean()
        .optional()
        .default(false)
        .describe("Bypass reviewer blocks (logged with warning)"),
    }),
```

- [ ] **Step 3: Add pre-commit review logic**

Add this function before the tool definition:

```typescript
/**
 * Run pre-commit reviewers on staged files.
 *
 * Returns object with:
 * - shouldBlock: true if CRITICAL issues found
 * - issues: array of parsed issues
 * - summary: human-readable summary
 */
async function runPreCommitReview(
  sandbox: any,
  workspaceDir: string,
): Promise<{ shouldBlock: boolean; issues: any[]; summary: string }> {
  try {
    // Check if pre-commit reviews are enabled
    if (process.env.REVIEWERS_PRE_COMMIT_ENABLED === "false") {
      return { shouldBlock: false, issues: [], summary: "Pre-commit reviews disabled" };
    }

    // Get staged files
    const diffResult = await runGit(sandbox, workspaceDir, "git diff --staged --name-only");
    if (!diffResult) {
      return { shouldBlock: false, issues: [], summary: "No staged files to review" };
    }

    const changedFiles = diffResult.trim().split("\\n").filter((f) => f.length > 0);
    if (changedFiles.length === 0) {
      return { shouldBlock: false, issues: [], summary: "No staged files to review" };
    }

    // Determine which reviewers to run
    const reviewersToRun = getReviewersForFiles(changedFiles);
    logger.info(`[pre-commit] Running reviewers: ${reviewersToRun.join(", ")}`);

    const allIssues: any[] = [];

    for (const reviewerName of reviewersToRun) {
      try {
        const reviewer = builtInSubagents.find((a) => a.name === reviewerName);
        if (!reviewer) continue;

        const agent = createDeepAgent({ subagents: [reviewer] });
        const prompt = `Review the following staged files for issues:\\n\\n${changedFiles.join("\\n")}\\n\\nRun git diff --staged to see the actual changes. Apply your review checklist and report any issues found.`;

        const result = await agent.invoke(
          { messages: [{ role: "user", content: prompt }] },
          { configurable: { thread_id: `pre-commit-${Date.now()}` } },
        );

        const output = result.messages[result.messages.length - 1]?.content || "";
        const issues = parseReviewerOutput(String(output));
        allIssues.push(...issues);
      } catch (err) {
        logger.warn(`[pre-commit] Reviewer ${reviewerName} failed:`, err);
      }
    }

    const criticalFound = hasCriticalIssues(allIssues);
    const summary = `Pre-commit review: ${allIssues.length} issue(s) found (${allIssues.filter((i) => i.severity === "CRITICAL").length} CRITICAL)`;

    return { shouldBlock: criticalFound, issues: allIssues, summary };
  } catch (error) {
    logger.error("[pre-commit] Review failed:", error);
    // Don't block on review failures
    return { shouldBlock: false, issues: [], summary: "Review failed, proceeding" };
  }
}
```

- [ ] **Step 4: Integrate pre-commit hook into tool logic**

Find the section after `await gitAddAll(sandbox, workspaceDir);` and add:

```typescript
      // Run pre-commit reviewers
      const reviewResult = await runPreCommitReview(sandbox, workspaceDir);

      if (reviewResult.shouldBlock) {
        if (force) {
          logger.warn("[commit_and_open_pr] Force override: proceeding despite CRITICAL issues");
        } else {
          return JSON.stringify({
            success: false,
            error: "Commit blocked by reviewers. CRITICAL issues must be fixed first.",
            blocked: true,
            issues: reviewResult.issues,
            summary: reviewResult.summary,
            pr_url: null,
          });
        }
      }

      logger.info(`[commit_and_open_pr] ${reviewResult.summary}`);
```

Also update the function signature to include force parameter:

```typescript
export const commitAndOpenPrTool = tool(
  async ({ title, body, commit_message, force }, config) => {
```

- [ ] **Step 5: Run typecheck**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/tools/commit-and-open-pr.ts
git commit -m "feat: add pre-commit reviewer hook to commit tool"
```

---

## Task 13: Write unit tests for reviewerMapping

**Files:**
- Create: `src/subagents/__tests__/reviewerMapping.test.ts`

- [ ] **Step 1: Create test file**

```typescript
import { describe, it, expect } from "bun:test";
import {
  getReviewersForFile,
  getReviewersForFiles,
  shouldReviewerReviewFile,
} from "../reviewerMapping";

describe("reviewerMapping", () => {
  describe("getReviewersForFile", () => {
    it("should return go-reviewer for .go files", () => {
      const result = getReviewersForFile("src/main.go");
      expect(result).toEqual(["code-reviewer", "go-reviewer"]);
    });

    it("should return python-reviewer for .py files", () => {
      const result = getReviewersForFile("src/app.py");
      expect(result).toEqual(["code-reviewer", "python-reviewer"]);
    });

    it("should return database-reviewer for .sql files", () => {
      const result = getReviewersForFile("migrations/001_init.sql");
      expect(result).toEqual(["code-reviewer", "database-reviewer"]);
    });

    it("should return security-reviewer for auth files", () => {
      const result = getReviewersForFile("src/auth/login.ts");
      expect(result).toEqual(["code-reviewer", "security-reviewer"]);
    });

    it("should return security-reviewer for API routes", () => {
      const result = getReviewersForFile("src/api/users.ts");
      expect(result).toEqual(["code-reviewer", "security-reviewer"]);
    });

    it("should return code-reviewer for unmatched files", () => {
      const result = getReviewersForFile("README.md");
      expect(result).toEqual(["code-reviewer"]);
    });
  });

  describe("getReviewersForFiles", () => {
    it("should return unique reviewers for multiple files", () => {
      const result = getReviewersForFiles([
        "src/main.go",
        "src/auth.py",
      ]);
      expect(result).toEqual([
        "code-reviewer",
        "go-reviewer",
        "python-reviewer",
      ]);
    });

    it("should deduplicate reviewers", () => {
      const result = getReviewersForFiles([
        "src/main.go",
        "src/handlers.go",
      ]);
      expect(result).toEqual([
        "code-reviewer",
        "go-reviewer",
      ]);
    });
  });

  describe("shouldReviewerReviewFile", () => {
    it("should return true when reviewer matches", () => {
      const result = shouldReviewerReviewFile("src/main.go", "go-reviewer");
      expect(result).toBe(true);
    });

    it("should return false when reviewer doesn't match", () => {
      const result = shouldReviewerReviewFile("src/main.go", "python-reviewer");
      expect(result).toBe(false);
    });

    it("should return true for code-reviewer on any file", () => {
      const result = shouldReviewerReviewFile("README.md", "code-reviewer");
      expect(result).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `bun test src/subagents/__tests__/reviewerMapping.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/subagents/__tests__/reviewerMapping.test.ts
git commit -m "test: add reviewerMapping unit tests"
```

---

## Task 14: Write unit tests for reviewerParser

**Files:**
- Create: `src/subagents/__tests__/reviewerParser.test.ts`

- [ ] **Step 1: Create test file**

```typescript
import { describe, it, expect } from "bun:test";
import {
  parseReviewerOutput,
  filterIssuesBySeverity,
  hasCriticalIssues,
  formatIssues,
  type ReviewIssue,
} from "../reviewerParser";

describe("reviewerParser", () => {
  describe("parseReviewerOutput", () => {
    const sampleOutput = \`[CRITICAL] Hardcoded API key
File: src/api/client.ts:42
Issue: API key exposed in source
Fix: Use process.env.API_KEY

[HIGH] Large function
File: src/utils.ts:100
Issue: Function is 80 lines long
Fix: Split into smaller functions

[MEDIUM] Missing JSDoc
File: src/api.ts:15
Issue: Public function lacks documentation
Fix: Add JSDoc comment\`;

    it("should parse multiple issues correctly", () => {
      const result = parseReviewerOutput(sampleOutput);
      expect(result).toHaveLength(3);
    });

    it("should parse severity correctly", () => {
      const result = parseReviewerOutput(sampleOutput);
      expect(result[0].severity).toBe("CRITICAL");
      expect(result[1].severity).toBe("HIGH");
      expect(result[2].severity).toBe("MEDIUM");
    });

    it("should parse file and line number", () => {
      const result = parseReviewerOutput(sampleOutput);
      expect(result[0].file).toBe("src/api/client.ts");
      expect(result[0].line).toBe(42);
    });

    it("should handle issues without line numbers", () => {
      const output = \`[HIGH] Missing test
File: src/utils.ts
Issue: No test coverage
Fix: Add unit tests\`;
      const result = parseReviewerOutput(output);
      expect(result[0].file).toBe("src/utils.ts");
      expect(result[0].line).toBeUndefined();
    });

    it("should return empty array for invalid output", () => {
      const result = parseReviewerOutput("No issues found!");
      expect(result).toEqual([]);
    });
  });

  describe("filterIssuesBySeverity", () => {
    const issues: ReviewIssue[] = [
      { severity: "LOW", file: "a.ts", issue: "Low", fix: "Fix" },
      { severity: "MEDIUM", file: "b.ts", issue: "Medium", fix: "Fix" },
      { severity: "HIGH", file: "c.ts", issue: "High", fix: "Fix" },
      { severity: "CRITICAL", file: "d.ts", issue: "Critical", fix: "Fix" },
    ];

    it("should filter by HIGH severity", () => {
      const result = filterIssuesBySeverity(issues, "HIGH");
      expect(result).toHaveLength(2);
      expect(result.every((i) => i.severity === "HIGH" || i.severity === "CRITICAL")).toBe(true);
    });

    it("should filter by CRITICAL severity", () => {
      const result = filterIssuesBySeverity(issues, "CRITICAL");
      expect(result).toHaveLength(1);
      expect(result[0].severity).toBe("CRITICAL");
    });

    it("should return all for LOW severity", () => {
      const result = filterIssuesBySeverity(issues, "LOW");
      expect(result).toHaveLength(4);
    });
  });

  describe("hasCriticalIssues", () => {
    it("should return true when CRITICAL issues exist", () => {
      const issues: ReviewIssue[] = [
        { severity: "HIGH", file: "a.ts", issue: "High", fix: "Fix" },
        { severity: "CRITICAL", file: "b.ts", issue: "Critical", fix: "Fix" },
      ];
      expect(hasCriticalIssues(issues)).toBe(true);
    });

    it("should return false when no CRITICAL issues", () => {
      const issues: ReviewIssue[] = [
        { severity: "HIGH", file: "a.ts", issue: "High", fix: "Fix" },
        { severity: "MEDIUM", file: "b.ts", issue: "Medium", fix: "Fix" },
      ];
      expect(hasCriticalIssues(issues)).toBe(false);
    });

    it("should return false for empty array", () => {
      expect(hasCriticalIssues([])).toBe(false);
    });
  });

  describe("formatIssues", () => {
    const issues: ReviewIssue[] = [
      { severity: "CRITICAL", file: "src/api.ts", line: 10, issue: "SQL injection", fix: "Use parameterized queries" },
      { severity: "HIGH", file: "src/utils.ts", issue: "Large function", fix: "Split it" },
    ];

    it("should format issues correctly", () => {
      const result = formatIssues(issues);
      expect(result).toContain("[CRITICAL] SQL injection");
      expect(result).toContain("File: src/api.ts:10");
      expect(result).toContain("Fix: Use parameterized queries");
      expect(result).toContain("[HIGH] Large function");
    });
  });
});
\`;

- [ ] **Step 2: Run tests**

Run: `bun test src/subagents/__tests__/reviewerParser.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/subagents/__tests__/reviewerParser.test.ts
git commit -m "test: add reviewerParser unit tests"
```

---

## Task 15: Update integration tests

**Files:**
- Modify: `src/subagents/__tests__/integration.test.ts`

- [ ] **Step 1: Update expected subagent count**

Find the line that checks subagent count and update:

\`\`\`typescript
expect(allSubagents.length).toBeGreaterThanOrEqual(builtInSubagents.length);
\`\`\`

The test should already pass since builtInSubagents now has 8 items.

- [ ] **Step 2: Run integration tests**

Run: `bun test src/subagents/__tests__/integration.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/subagents/__tests__/integration.test.ts
git commit -m "test: update integration tests for new reviewers"
```

---

## Task 16: Update AGENTS.md documentation

**Files:**
- Modify: `src/subagents/AGENTS.md`

- [ ] **Step 1: Add reviewer agents to documentation**

Add to the "Built-in subagent registry" section:

\`\`\`markdown
## Built-in Subagents

| Name | Description |
|------|-------------|
| explore-agent | Fast, read-only codebase exploration |
| plan-agent | Software architect and planning specialist |
| general-purpose | Versatile agent with all tools |
| code-reviewer | General code quality, security, and maintainability |
| database-reviewer | PostgreSQL optimization and schema design |
| security-reviewer | OWASP Top 10 and vulnerability detection |
| go-reviewer | Idiomatic Go, concurrency, and error handling |
| python-reviewer | PEP 8 compliance and Pythonic patterns |
\`\`\`

- [ ] **Step 2: Run typecheck**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/subagents/AGENTS.md
git commit -m "docs: update AGENTS.md with reviewer subagents"
```

---

## Task 17: Run full test suite

**Files:**
- All files

- [ ] **Step 1: Run all tests**

Run: `bun test src/subagents/__tests__/`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify tool exports**

Run: `bun -e "import { runReviewersTool } from './src/tools/index.ts'; console.log('Tool exported successfully');"`

Expected: No errors, "Tool exported successfully" printed

- [ ] **Step 4: Commit any fixes**

```bash
# If any fixes were needed
git add -A && git commit -m "fix: resolve test and typecheck issues"
```

---

## Success Criteria

- [ ] All 5 reviewer agents defined in registry
- [ ] System prompts extracted from documentation to prompt files
- [ ] Pre-commit hook integrated into commit tool
- [ ] run_reviewers tool functional
- [ ] Tests pass (unit + integration)
- [ ] Documentation updated (AGENTS.md)
