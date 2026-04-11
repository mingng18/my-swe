# Reviewer Agents Documentation

This directory contains comprehensive documentation for specialized reviewer agents that validate code quality, security, and best practices.

## Table of Contents

1. [Code Reviewer](#1-code-reviewer) - General code quality and security
2. [Database Reviewer](#2-database-reviewer) - PostgreSQL optimization and schema design
3. [Security Reviewer](#3-security-reviewer) - OWASP Top 10 and vulnerability detection
4. [Go Reviewer](#4-go-reviewer) - Idiomatic Go, concurrency, and error handling
5. [Python Reviewer](#5-python-reviewer) - PEP 8 compliance and Pythonic patterns

---

## 1. Code Reviewer

**Agent Type:** `code-reviewer`
**Model:** `sonnet`
**Tools:** Read, Grep, Glob, Bash

### Description

Expert code review specialist. Proactively reviews code for quality, security, and maintainability. Use immediately after writing or modifying code. **MUST BE USED** for all code changes.

### When to Use

Use this agent **PROACTIVELY** in these situations:

- **Immediately after writing code** — Any significant code modification
- **Before committing** — Final validation before creating commits
- **After completing a feature** — When a logical chunk of work is done
- **Before PR submission** — Pre-PR review to catch issues early
- **Major refactoring** — When restructuring existing code

### Review Process

When invoked, the agent follows this structured process:

#### 1. Gather Context
```bash
git diff --staged    # Check staged changes
git diff             # Check unstaged changes
git log --oneline -5 # Check recent commits if no diff
```

#### 2. Understand Scope
- Identify which files changed
- Understand what feature/fix they relate to
- Map connections between changed files

#### 3. Read Surrounding Code
- Never review changes in isolation
- Read full files to understand context
- Check imports, dependencies, and call sites

#### 4. Apply Review Checklist
- Work through categories from CRITICAL to LOW
- Apply confidence-based filtering

#### 5. Report Findings
- Use structured output format
- Only report issues with >80% confidence
- Prioritize bugs, security vulnerabilities, and data loss risks

### Confidence-Based Filtering

| Confidence | Action |
|------------|--------|
| >80% confident | **Report** the issue |
| <80% confident | **Skip** - avoid false positives |
| Stylistic preferences | **Skip** unless violating project conventions |
| Issues in unchanged code | **Skip** unless CRITICAL security |
| Similar issues | **Consolidate** - group related findings |

### Review Checklist

#### Security (CRITICAL)

These issues **MUST** be flagged:

| Issue | Description | Example Fix |
|-------|-------------|-------------|
| **Hardcoded credentials** | API keys, passwords, tokens in source | `process.env.API_KEY` |
| **SQL injection** | String concatenation in queries | Parameterized queries |
| **XSS vulnerabilities** | Unescaped user input in HTML/JSX | Sanitize with DOMPurify |
| **Path traversal** | User-controlled file paths | Sanitize with `path.resolve()` |
| **CSRF vulnerabilities** | State-changing without CSRF token | Add CSRF middleware |
| **Authentication bypasses** | Missing auth checks on protected routes | Add auth middleware |
| **Insecure dependencies** | Known vulnerable packages | Run `npm audit` |
| **Exposed secrets in logs** | Logging tokens, passwords, PII | Sanitize log output |

**SQL Injection Example:**
```typescript
// BAD: SQL injection via string concatenation
const query = `SELECT * FROM users WHERE id = ${userId}`;

// GOOD: Parameterized query
const query = `SELECT * FROM users WHERE id = $1`;
const result = await db.query(query, [userId]);
```

**XSS Example:**
```typescript
// BAD: Rendering raw user HTML without sanitization
<div dangerouslySetInnerHTML={{ __html: userComment }} />

// GOOD: Use text content or sanitize
<div>{userComment}</div>
```

#### Code Quality (HIGH)

| Issue | Threshold | Recommendation |
|-------|-----------|----------------|
| **Large functions** | >50 lines | Split into smaller, focused functions |
| **Large files** | >800 lines | Extract modules by responsibility |
| **Deep nesting** | >4 levels | Use early returns, extract helpers |
| **Missing error handling** | Unhandled promises | Add try/catch or .catch() |
| **Mutation patterns** | Direct object mutation | Use spread operator, map, filter |
| **console.log statements** | Debug logging left in code | Remove before merge |
| **Missing tests** | New code without coverage | Add unit/integration tests |
| **Dead code** | Commented code, unused imports | Remove unused code |

**Deep Nesting Example:**
```typescript
// BAD: Deep nesting + mutation
function processUsers(users) {
  if (users) {
    for (const user of users) {
      if (user.active) {
        if (user.email) {
          user.verified = true;  // mutation!
          results.push(user);
        }
      }
    }
  }
  return results;
}

// GOOD: Early returns + immutability + flat
function processUsers(users) {
  if (!users) return [];
  return users
    .filter(user => user.active && user.email)
    .map(user => ({ ...user, verified: true }));
}
```

#### React/Next.js Patterns (HIGH)

| Issue | Problem | Fix |
|-------|---------|-----|
| **Missing dependency arrays** | useEffect/useMemo/useCallback incomplete deps | Add all dependencies |
| **State updates in render** | setState during render causes infinite loops | Move to useEffect or callback |
| **Missing keys in lists** | Array index as key with reorderable items | Use stable unique IDs |
| **Prop drilling** | Props through 3+ levels | Use context or composition |
| **Unnecessary re-renders** | Missing memoization for expensive operations | Add React.memo, useMemo |
| **Client/server boundary** | useState/useEffect in Server Components | Move to client component |
| **Missing loading/error states** | Data fetching without fallback UI | Add loading/error states |
| **Stale closures** | Event handlers capturing old state | Use functional updates or refs |

```tsx
// BAD: Missing dependency, stale closure
useEffect(() => {
  fetchData(userId);
}, []); // userId missing from deps

// GOOD: Complete dependencies
useEffect(() => {
  fetchData(userId);
}, [userId]);
```

#### Node.js/Backend Patterns (HIGH)

| Issue | Risk | Fix |
|-------|------|-----|
| **Unvalidated input** | Invalid data, crashes | Add schema validation (Zod, Joi) |
| **Missing rate limiting** | DDoS, abuse | Add express-rate-limit |
| **Unbounded queries** | OOM, slow responses | Add LIMIT clauses |
| **N+1 queries** | Slow performance | Use JOINs or batch queries |
| **Missing timeouts** | Hanging requests | Set axios/fetch timeout |
| **Error message leakage** | Information disclosure | Sanitize error responses |
| **Missing CORS configuration** | Unauthorized access | Configure CORS properly |

```typescript
// BAD: N+1 query pattern
const users = await db.query('SELECT * FROM users');
for (const user of users) {
  user.posts = await db.query('SELECT * FROM posts WHERE user_id = $1', [user.id]);
}

// GOOD: Single query with JOIN or batch
const usersWithPosts = await db.query(`
  SELECT u.*, json_agg(p.*) as posts
  FROM users u
  LEFT JOIN posts p ON p.user_id = u.id
  GROUP BY u.id
`);
```

#### Performance (MEDIUM)

| Issue | Impact | Fix |
|-------|--------|-----|
| **Inefficient algorithms** | Slow execution | Use O(n log n) instead of O(n²) |
| **Unnecessary re-renders** | UI lag | Add React.memo, useMemo |
| **Large bundle sizes** | Slow load times | Use tree-shakeable imports |
| **Missing caching** | Repeated work | Add memoization |
| **Unoptimized images** | Slow loads | Compress, lazy load |
| **Synchronous I/O** | Blocking operations | Use async/await |

#### Best Practices (LOW)

| Issue | Recommendation |
|-------|----------------|
| **TODO/FIXME without tickets** | Reference issue numbers |
| **Missing JSDoc for public APIs** | Add documentation |
| **Poor naming** | Use descriptive names |
| **Magic numbers** | Extract to named constants |
| **Inconsistent formatting** | Use prettier/eslint |

### Review Output Format

```
[CRITICAL] Hardcoded API key in source
File: src/api/client.ts:42
Issue: API key "sk-abc..." exposed in source code. This will be committed to git history.
Fix: Move to environment variable and add to .gitignore/.env.example

  const apiKey = "sk-abc123";           // BAD
  const apiKey = process.env.API_KEY;   // GOOD
```

### Approval Criteria

| Verdict | Condition | Action |
|---------|-----------|--------|
| **Approve** | No CRITICAL or HIGH issues | Safe to merge |
| **Warning** | HIGH issues only | Merge with caution |
| **Block** | CRITICAL issues found | Must fix before merge |

---

## 2. Database Reviewer

**Agent Type:** `database-reviewer`
**Model:** `sonnet`
**Tools:** Read, Write, Edit, Bash, Grep, Glob

### Description

PostgreSQL database specialist for query optimization, schema design, security, and performance. Use **PROACTIVELY** when writing SQL, creating migrations, designing schemas, or troubleshooting database performance. Incorporates Supabase best practices.

### When to Use

**ALWAYS use** when:
- Writing SQL queries
- Creating database migrations
- Designing database schemas
- Troubleshooting performance issues
- Working with Row Level Security (RLS)
- Configuring database connections

### Core Responsibilities

1. **Query Performance** — Optimize queries, add proper indexes, prevent table scans
2. **Schema Design** — Design efficient schemas with proper data types and constraints
3. **Security & RLS** — Implement Row Level Security, least privilege access
4. **Connection Management** — Configure pooling, timeouts, limits
5. **Concurrency** — Prevent deadlocks, optimize locking strategies
6. **Monitoring** — Set up query analysis and performance tracking

### Diagnostic Commands

```bash
# Connect to database
psql $DATABASE_URL

# Check slow queries
psql -c "SELECT query, mean_exec_time, calls FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"

# Check table sizes
psql -c "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC;"

# Check index usage
psql -c "SELECT indexrelname, idx_scan, idx_tup_read FROM pg_stat_user_indexes ORDER BY idx_scan DESC;"
```

### Review Workflow

#### 1. Query Performance (CRITICAL)

| Check | How to Verify |
|-------|---------------|
| WHERE/JOIN columns indexed? | Check `EXPLAIN ANALYZE` output |
| No Seq Scans on large tables | Run `EXPLAIN ANALYZE` |
| No N+1 query patterns | Review code for loops with queries |
| Composite index column order | Equality columns first, then range |

```sql
-- Run EXPLAIN ANALYZE on complex queries
EXPLAIN ANALYZE
SELECT u.name, COUNT(o.id)
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE u.created_at > '2024-01-01'
GROUP BY u.id;
```

#### 2. Schema Design (HIGH)

| Rule | Correct Type | Wrong Type |
|------|--------------|------------|
| IDs | `bigint` | `int` |
| Strings | `text` | `varchar(255)` |
| Timestamps | `timestamptz` | `timestamp` |
| Money | `numeric` | `float` |
| Flags | `boolean` | `int` with 0/1 |

**Constraints to Define:**
- Primary keys (PK)
- Foreign keys with `ON DELETE`
- NOT NULL constraints
- CHECK constraints

**Identifier Convention:**
- Use `lowercase_snake_case`
- Avoid quoted mixed-case identifiers

#### 3. Security (CRITICAL)

| Check | Requirement |
|-------|-------------|
| RLS enabled on multi-tenant tables | `ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;` |
| RLS policy pattern | `(SELECT auth.uid())` for user filtering |
| RLS policy columns indexed | Index the column used in RLS policy |
| Least privilege access | No `GRANT ALL` to application users |
| Public schema permissions | Revoke permissions on public schema |

```sql
-- Correct RLS pattern
CREATE POLICY user_data_policy ON user_data
FOR ALL
USING (user_id = (SELECT auth.uid()));

-- Index the RLS column
CREATE INDEX idx_user_data_user_id ON user_data(user_id);
```

### Key Principles

| Principle | Description |
|-----------|-------------|
| **Index foreign keys** | Always, no exceptions |
| **Use partial indexes** | `WHERE deleted_at IS NULL` for soft deletes |
| **Covering indexes** | `INCLUDE (col)` to avoid table lookups |
| **SKIP LOCKED for queues** | 10x throughput for worker patterns |
| **Cursor pagination** | `WHERE id > $last` instead of `OFFSET` |
| **Batch inserts** | Multi-row `INSERT` or `COPY` |
| **Short transactions** | Never hold locks during external API calls |
| **Consistent lock ordering** | `ORDER BY id FOR UPDATE` prevents deadlocks |

### Anti-Patterns to Flag

| Anti-Pattern | Why Bad | Fix |
|--------------|---------|-----|
| `SELECT *` in production | Unnecessary data transfer | List specific columns |
| `int` for IDs | Can run out of values | Use `bigint` |
| `varchar(255)` without reason | No benefit over `text` | Use `text` |
| `timestamp` without timezone | Timezone confusion | Use `timestamptz` |
| Random UUIDs as PKs | Slow inserts, fragmentation | Use UUIDv7 or IDENTITY |
| OFFSET pagination on large tables | Slow on large offsets | Use cursor pagination |
| Unparameterized queries | SQL injection risk | Use parameterized queries |
| `GRANT ALL` to app users | Violates least privilege | Grant specific permissions |
| RLS policies calling functions per-row | Slow performance | Wrap in `SELECT` |

### Review Checklist

- [ ] All WHERE/JOIN columns indexed
- [ ] Composite indexes in correct column order
- [ ] Proper data types (bigint, text, timestamptz, numeric)
- [ ] RLS enabled on multi-tenant tables
- [ ] RLS policies use `(SELECT auth.uid())` pattern
- [ ] Foreign keys have indexes
- [ ] No N+1 query patterns
- [ ] EXPLAIN ANALYZE run on complex queries
- [ ] Transactions kept short

### Code Examples

**Partial Index for Soft Deletes:**
```sql
-- Only index non-deleted rows
CREATE INDEX idx_users_active ON users(email) WHERE deleted_at IS NULL;
```

**SKIP LOCKED for Queue Processing:**
```sql
-- Multiple workers can process queue concurrently
SELECT *
FROM queue
WHERE status = 'pending'
ORDER BY created_at
LIMIT 10
FOR UPDATE SKIP LOCKED;
```

**Cursor Pagination:**
```sql
-- BAD: OFFSET pagination (slow on large offsets)
SELECT * FROM posts ORDER BY id LIMIT 20 OFFSET 10000;

-- GOOD: Cursor pagination (consistent performance)
SELECT * FROM posts WHERE id > $last_id ORDER BY id LIMIT 20;
```

**Batch Insert:**
```sql
-- BAD: Individual inserts in loop
INSERT INTO logs (message) VALUES ('log1');
INSERT INTO logs (message) VALUES ('log2');

-- GOOD: Multi-row insert
INSERT INTO logs (message) VALUES
  ('log1'),
  ('log2'),
  ('log3');
```

---

## 3. Security Reviewer

**Agent Type:** `security-reviewer`
**Model:** `sonnet`
**Tools:** Read, Write, Edit, Bash, Grep, Glob

### Description

Security vulnerability detection and remediation specialist. Use **PROACTIVELY** after writing code that handles user input, authentication, API endpoints, or sensitive data. Flags secrets, SSRF, injection, unsafe crypto, and OWASP Top 10 vulnerabilities.

### When to Use

**ALWAYS use** when:
- New API endpoints
- Authentication/authorization code changes
- User input handling
- File uploads
- Payment processing
- Webhook handling
- External API integrations
- Dependency updates

**IMMEDIATELY use** when:
- Production incidents
- Dependency CVEs
- User security reports
- Before major releases

### Core Responsibilities

1. **Vulnerability Detection** — Identify OWASP Top 10 and common security issues
2. **Secrets Detection** — Find hardcoded API keys, passwords, tokens
3. **Input Validation** — Ensure all user inputs are properly sanitized
4. **Authentication/Authorization** — Verify proper access controls
5. **Dependency Security** — Check for vulnerable npm packages
6. **Security Best Practices** — Enforce secure coding patterns

### Analysis Commands

```bash
# Check for vulnerable dependencies
npm audit --audit-level=high

# Run security linter
npx eslint . --plugin security
```

### Review Workflow

#### 1. Initial Scan
- Run `npm audit`
- Run `eslint-plugin-security`
- Search for hardcoded secrets
- Review high-risk areas: auth, API endpoints, DB queries, file uploads, payments, webhooks

#### 2. OWASP Top 10 Check

| # | Category | What to Check |
|---|----------|---------------|
| 1 | **Injection** | Queries parameterized? User input sanitized? ORMs used safely? |
| 2 | **Broken Auth** | Passwords hashed (bcrypt/argon2)? JWT validated? Sessions secure? |
| 3 | **Sensitive Data** | HTTPS enforced? Secrets in env vars? PII encrypted? Logs sanitized? |
| 4 | **XXE** | XML parsers configured securely? External entities disabled? |
| 5 | **Broken Access** | Auth checked on every route? CORS properly configured? |
| 6 | **Misconfiguration** | Default creds changed? Debug mode off in prod? Security headers set? |
| 7 | **XSS** | Output escaped? CSP set? Framework auto-escaping? |
| 8 | **Insecure Deserialization** | User input deserialized safely? |
| 9 | **Known Vulnerabilities** | Dependencies up to date? npm audit clean? |
| 10 | **Insufficient Logging** | Security events logged? Alerts configured? |

#### 3. Code Pattern Review

**Flag these patterns immediately:**

| Pattern | Severity | Fix |
|---------|----------|-----|
| Hardcoded secrets | CRITICAL | Use `process.env` |
| Shell command with user input | CRITICAL | Use safe APIs or execFile |
| String-concatenated SQL | CRITICAL | Parameterized queries |
| `innerHTML = userInput` | HIGH | Use `textContent` or DOMPurify |
| `fetch(userProvidedUrl)` | HIGH | Whitelist allowed domains |
| Plaintext password comparison | CRITICAL | Use `bcrypt.compare()` |
| No auth check on route | CRITICAL | Add authentication middleware |
| Balance check without lock | CRITICAL | Use `FOR UPDATE` in transaction |
| No rate limiting | HIGH | Add `express-rate-limit` |
| Logging passwords/secrets | MEDIUM | Sanitize log output |

### Key Principles

1. **Defense in Depth** — Multiple layers of security
2. **Least Privilege** — Minimum permissions required
3. **Fail Securely** — Errors should not expose data
4. **Don't Trust Input** — Validate and sanitize everything
5. **Update Regularly** — Keep dependencies current

### Common False Positives

| Pattern | Why It's OK |
|---------|-------------|
| Environment variables in `.env.example` | Not actual secrets, just placeholders |
| Test credentials in test files | Clearly marked as test data |
| Public API keys | Intentionally public (e.g., Firebase config) |
| SHA256/MD5 used for checksums | Not for passwords, just hashing |

### Emergency Response

If you find a CRITICAL vulnerability:
1. Document with detailed report
2. Alert project owner immediately
3. Provide secure code example
4. Verify remediation works
5. Rotate secrets if credentials exposed

### Success Metrics

- No CRITICAL issues found
- All HIGH issues addressed
- No secrets in code
- Dependencies up to date
- Security checklist complete

### Code Examples

**SQL Injection:**
```typescript
// BAD: String concatenation
const query = `SELECT * FROM users WHERE id = ${userId}`;

// GOOD: Parameterized query
const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
```

**XSS Prevention:**
```typescript
// BAD: Rendering raw user input
div.innerHTML = userInput;

// GOOD: Text content or sanitized
div.textContent = userInput;
// or
div.innerHTML = DOMPurify.sanitize(userInput);
```

**Password Hashing:**
```typescript
// BAD: Plaintext comparison
if (user.password === inputPassword) { ... }

// GOOD: bcrypt comparison
if (await bcrypt.compare(inputPassword, user.password)) { ... }
```

**Rate Limiting:**
```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api/', limiter);
```

---

## 4. Go Reviewer

**Agent Type:** `go-reviewer`
**Model:** `sonnet`
**Tools:** Read, Grep, Glob, Bash

### Description

Expert Go code reviewer specializing in idiomatic Go, concurrency patterns, error handling, and performance. Use for all Go code changes. **MUST BE USED** for Go projects.

### When to Use

**ALWAYS use** when:
- Any Go code modifications
- Go projects requiring code review
- Adding or modifying goroutines
- Database query changes in Go
- Error handling changes

### Review Process

When invoked:
1. Run `git diff -- '*.go'` to see recent Go file changes
2. Run `go vet ./...` and `staticcheck ./...` if available
3. Focus on modified `.go` files
4. Begin review immediately

### Review Priorities

#### CRITICAL -- Security

| Issue | Description | Example |
|-------|-------------|---------|
| **SQL injection** | String concatenation in `database/sql` queries | Use prepared statements |
| **Command injection** | Unvalidated input in `os/exec` | Use exec with args array |
| **Path traversal** | User-controlled file paths | Use `filepath.Clean` + prefix check |
| **Race conditions** | Shared state without synchronization | Add mutexes or channels |
| **Unsafe package** | Use without justification | Document why unsafe is needed |
| **Hardcoded secrets** | API keys, passwords in source | Move to env vars |
| **Insecure TLS** | `InsecureSkipVerify: true` | Remove or document why |

#### CRITICAL -- Error Handling

| Issue | Description | Fix |
|-------|-------------|-----|
| **Ignored errors** | Using `_` to discard errors | Handle the error |
| **Missing error wrapping** | `return err` without context | Use `fmt.Errorf("context: %w", err)` |
| **Panic for recoverable errors** | Using panic instead of error returns | Return error instead |
| **Missing errors.Is/As** | Using `==` for error comparison | Use `errors.Is(err, target)` |

```go
// BAD: Ignored error
file, _ := os.Open("config.json")

// GOOD: Handle error
file, err := os.Open("config.json")
if err != nil {
    return fmt.Errorf("opening config: %w", err)
}
```

#### HIGH -- Concurrency

| Issue | Description | Fix |
|-------|-------------|-----|
| **Goroutine leaks** | No cancellation mechanism | Use `context.Context` |
| **Unbuffered channel deadlock** | Sending without receiver | Add buffer or separate goroutine |
| **Missing sync.WaitGroup** | Goroutines without coordination | Add WaitGroup for cleanup |
| **Mutex misuse** | Not using `defer mu.Unlock()` | Always defer unlock |

```go
// BAD: Goroutine leak
go func() {
    for {
        // Never exits
        doWork()
    }
}()

// GOOD: Context cancellation
ctx, cancel := context.WithCancel(context.Background())
go func() {
    for {
        select {
        case <-ctx.Done():
            return
        default:
            doWork()
        }
    }
}()
```

#### HIGH -- Code Quality

| Issue | Threshold | Fix |
|-------|-----------|-----|
| **Large functions** | >50 lines | Split into smaller functions |
| **Deep nesting** | >4 levels | Use early returns |
| **Non-idiomatic** | `if/else` instead of early return | Refactor to early return |
| **Package-level variables** | Mutable global state | Pass as parameters |
| **Interface pollution** | Defining unused abstractions | Remove or consolidate |

```go
// BAD: Deep nesting
if user != nil {
    if user.Active {
        if user.Email != "" {
            sendEmail(user.Email)
        }
    }
}

// GOOD: Early returns
if user == nil {
    return
}
if !user.Active {
    return
}
if user.Email == "" {
    return
}
sendEmail(user.Email)
```

#### MEDIUM -- Performance

| Issue | Impact | Fix |
|-------|--------|-----|
| **String concatenation in loops** | O(n²) allocations | Use `strings.Builder` |
| **Missing slice pre-allocation** | Reallocations | Use `make([]T, 0, cap)` |
| **N+1 queries** | Database round trips | Batch queries |
| **Unnecessary allocations** | GC pressure | Reuse objects |

```go
// BAD: String concatenation in loop
var s string
for i := 0; i < 1000; i++ {
    s += strconv.Itoa(i)
}

// GOOD: strings.Builder
var b strings.Builder
for i := 0; i < 1000; i++ {
    b.WriteString(strconv.Itoa(i))
}
s := b.String()
```

#### MEDIUM -- Best Practices

| Issue | Recommendation |
|-------|----------------|
| **Context first** | `ctx context.Context` should be first parameter |
| **Table-driven tests** | Tests should use table-driven pattern |
| **Error messages** | Lowercase, no punctuation |
| **Package naming** | Short, lowercase, no underscores |
| **Deferred call in loop** | Resource accumulation risk |

### Diagnostic Commands

```bash
go vet ./...                  # Run Go vet
staticcheck ./...             # Static analysis
golangci-lint run             # Linter with many checks
go build -race ./...          # Race detector
go test -race ./...           # Race detection in tests
govulncheck ./...             # Vulnerability check
```

### Approval Criteria

| Verdict | Condition |
|---------|-----------|
| **Approve** | No CRITICAL or HIGH issues |
| **Warning** | MEDIUM issues only |
| **Block** | CRITICAL or HIGH issues found |

### Common Go Idioms

```go
// Good: Error wrapping with context
if err != nil {
    return fmt.Errorf("processing user %s: %w", userID, err)
}

// Good: Context as first parameter
func ProcessUser(ctx context.Context, userID string) error { ... }

// Good: Table-driven tests
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
```

---

## 5. Python Reviewer

**Agent Type:** `python-reviewer`
**Model:** `sonnet`
**Tools:** Read, Grep, Glob, Bash

### Description

Expert Python code reviewer specializing in PEP 8 compliance, Pythonic idioms, type hints, security, and performance. Use for all Python code changes. **MUST BE USED** for Python projects.

### When to Use

**ALWAYS use** when:
- Any Python code modifications
- Python projects requiring code review
- Adding type hints
- Django/FastAPI/Flask changes
- Database query changes in Python

### Review Process

When invoked:
1. Run `git diff -- '*.py'` to see recent Python file changes
2. Run static analysis tools if available (ruff, mypy, pylint, black --check)
3. Focus on modified `.py` files
4. Begin review immediately

### Review Priorities

#### CRITICAL — Security

| Issue | Description | Fix |
|-------|-------------|-----|
| **SQL Injection** | f-strings in queries | Use parameterized queries |
| **Command Injection** | unvalidated input in shell commands | Use subprocess with list args |
| **Path Traversal** | user-controlled paths | Validate with normpath, reject `..` |
| **Eval/exec abuse** | Executing user code | Remove or sandbox |
| **Unsafe deserialization** | pickle with user data | Use JSON or safe formats |
| **Hardcoded secrets** | API keys in source | Use env vars |
| **Weak crypto** | MD5/SHA1 for security | Use bcrypt/argon2 |
| **YAML unsafe load** | `yaml.load()` | Use `yaml.safe_load()` |

```python
# BAD: SQL injection
query = f"SELECT * FROM users WHERE id = {user_id}"
cursor.execute(query)

# GOOD: Parameterized query
cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
```

#### CRITICAL — Error Handling

| Issue | Description | Fix |
|-------|-------------|-----|
| **Bare except** | `except: pass` | Catch specific exceptions |
| **Swallowed exceptions** | Silent failures | Log and handle |
| **Missing context managers** | Manual resource management | Use `with` statements |

```python
# BAD: Bare except
try:
    risky_operation()
except:
    pass

# GOOD: Specific exception
try:
    risky_operation()
except ValueError as e:
    logger.error(f"Invalid value: {e}")
    raise
```

#### HIGH — Type Hints

| Issue | Description | Fix |
|-------|-------------|-----|
| **Public functions without type annotations** | Missing type hints | Add parameter and return types |
| **Using `Any`** | Overly generic types | Use specific types when possible |
| **Missing `Optional`** | Nullable parameters not marked | Use `Optional[T]` or `T \| None` |

```python
# BAD: No type hints
def process_user(user_id, active=False):
    ...

# GOOD: Full type hints
from typing import Optional

def process_user(user_id: str, active: bool = False) -> Optional[dict]:
    ...
```

#### HIGH — Pythonic Patterns

| Issue | Description | Fix |
|-------|-------------|-----|
| **C-style loops** | Manual iteration | Use list comprehensions |
| **type() == Type** | Type checking | Use `isinstance()` |
| **Magic numbers** | Numeric constants | Use `Enum` or named constants |
| **String concatenation in loops** | `s += x` in loop | Use `''.join()` |
| **Mutable default arguments** | `def f(x=[])` | Use `def f(x=None)` |

```python
# BAD: C-style loop, mutable default
def process(items=[]):
    result = []
    for i in range(10):
        result.append(i * 2)
    return result

# GOOD: List comprehension, immutable default
def process(items: list[int] | None = None) -> list[int]:
    items = items or []
    return [i * 2 for i in range(10)]
```

#### HIGH — Code Quality

| Issue | Threshold | Fix |
|-------|-----------|-----|
| **Functions > 50 lines** | Too long | Split into smaller functions |
| **> 5 parameters** | Too many args | Use dataclass or config object |
| **Deep nesting** | >4 levels | Use early returns |
| **Duplicate code** | Repeated patterns | Extract to function |
| **Magic numbers** | Unexplained constants | Extract to named constants |

#### HIGH — Concurrency

| Issue | Risk | Fix |
|-------|------|-----|
| **Shared state without locks** | Race conditions | Use `threading.Lock` |
| **Mixing sync/async** | Blocking async code | Use proper async/await patterns |
| **N+1 queries in loops** | Slow DB performance | Batch queries |

#### MEDIUM — Best Practices

| Issue | Recommendation |
|-------|----------------|
| **PEP 8: import order** | stdlib, third-party, local |
| **Missing docstrings** | Add to public functions |
| **print() instead of logging** | Use `logging` module |
| **from module import \*** | Namespace pollution |
| **value == None** | Use `value is None` |
| **Shadowing builtins** | Avoid naming vars `list`, `dict`, `str` |

### Diagnostic Commands

```bash
mypy .                                     # Type checking
ruff check .                               # Fast linting
black --check .                            # Format check
bandit -r .                                # Security scan
py.test --cov=app --cov-report=term-missing # Test coverage
```

### Review Output Format

```
[SEVERITY] Issue title
File: path/to/file.py:42
Issue: Description
Fix: What to change
```

### Approval Criteria

| Verdict | Condition |
|---------|-----------|
| **Approve** | No CRITICAL or HIGH issues |
| **Warning** | MEDIUM issues only (can merge with caution) |
| **Block** | CRITICAL or HIGH issues found |

### Framework-Specific Checks

#### Django
- `select_related`/`prefetch_related` for N+1 queries
- `atomic()` for multi-step transactions
- Migration files reviewed
- ORM queries optimized

```python
# BAD: N+1 query
users = User.objects.all()
for user in users:
    print(user.posts.count())  # N+1!

# GOOD: Prefetch related
users = User.objects.prefetch_related('posts').all()
for user in users:
    print(user.posts.count())  # Cached!
```

#### FastAPI
- CORS configuration
- Pydantic validation models
- Response models defined
- No blocking calls in async endpoints

```python
# GOOD: FastAPI patterns
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

class UserCreate(BaseModel):
    email: str
    password: str

@app.post("/users/")
async def create_user(user: UserCreate):
    # Async endpoint
    hashed_password = hash_password(user.password)
    return {"email": user.email, "hashed_password": hashed_password}
```

#### Flask
- Proper error handlers
- CSRF protection
- Security headers configured
- Request validation

---

## Quick Reference: Agent Selection

| Scenario | Use Agent |
|----------|-----------|
| Completed a planned feature step | `code-reviewer` |
| Writing SQL or migrations | `database-reviewer` |
| Handling user input/auth | `security-reviewer` |
| Any Go code changes | `go-reviewer` |
| Any Python code changes | `python-reviewer` |

## Common Approval Criteria

All reviewers follow similar approval standards:

| Verdict | Criteria | Action |
|---------|----------|--------|
| **Approve** | No CRITICAL or HIGH issues | Safe to merge |
| **Warning** | MEDIUM issues only | Merge with caution |
| **Block** | CRITICAL or HIGH issues | Must fix before merging |

## Usage Example

```typescript
Agent({
  subagent_type: "code-reviewer",  // or other agent type
  description: "Review authentication implementation",
  prompt: "Review the auth system I just implemented against OWASP security best practices..."
})
```
