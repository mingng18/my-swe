# Design: Four Tool Features

Date: 2026-05-23

## Overview

Four features for the Bullhorse agent toolset:
1. **Close/Reopen GitHub Issue Tools** - New tools for issue lifecycle management
2. **Rate Limiting Enhancements** - Headers, env config, broader coverage
3. **Sandbox Grep Improvements** - File filtering, binary skipping
4. **Artifact Update Improvements** - Size validation, append/prepend modes, tests

---

## 1. Close/Reopen GitHub Issue Tools

### Problem

The existing GitHub tools support creating and commenting on issues but cannot change issue state. Close and reopen operations complete the basic issue lifecycle.

### Approach

Two separate tool files following the existing pattern (`create-github-issue.ts`, `comment-github-issue.ts`).

### Files

| File | Action |
|------|--------|
| `src/utils/github/api.ts` | Add `closeGithubIssue()`, `reopenGithubIssue()` |
| `src/utils/github/index.ts` | Export new functions |
| `src/tools/close-github-issue.ts` | New tool file |
| `src/tools/reopen-github-issue.ts` | New tool file |
| `src/tools/__tests__/close-github-issue.test.ts` | New test |
| `src/tools/__tests__/reopen-github-issue.test.ts` | New test |
| `src/tools/index.ts` | Register both tools in all tool arrays |

### API Functions

```typescript
// src/utils/github/api.ts

export async function closeGithubIssue(
  repoOwner: string,
  repoName: string,
  githubToken: string,
  issueNumber: number,
): Promise<{ url: string | null; number: number | null; state: string }> {
  const octokit = new Octokit({ auth: githubToken });
  const { data } = await octokit.rest.issues.update({
    owner: repoOwner,
    repo: repoName,
    issue_number: issueNumber,
    state: "closed",
  });
  invalidateRepoCache(repoOwner, repoName);
  return { url: data.html_url, number: data.number, state: data.state };
}

export async function reopenGithubIssue(
  repoOwner: string,
  repoName: string,
  githubToken: string,
  issueNumber: number,
): Promise<{ url: string | null; number: number | null; state: string }> {
  const octokit = new Octokit({ auth: githubToken });
  const { data } = await octokit.rest.issues.update({
    owner: repoOwner,
    repo: repoName,
    issue_number: issueNumber,
    state: "open",
  });
  invalidateRepoCache(repoOwner, repoName);
  return { url: data.html_url, number: data.number, state: data.state };
}
```

### Tool Structure

Each tool follows the pattern from `comment-github-issue.ts`:

- **Schema**: `issue_number: z.number().int().positive()`
- **Config**: reads `repo.owner`, `repo.name` from `config.configurable`
- **Token resolution**: `GITHUB_TOKEN` env var → `getGithubTokenFromThread` fallback
- **Return**: `{ success: boolean, issue_url, issue_number, state }` as JSON string
- **Citation reminder**: appended to response like `create-github-issue.ts`

### Registration

Both tools added to `allToolsUncompressed`, `sandboxAllToolsUncompressed`, `allTools`, and `sandboxAllTools` in `src/tools/index.ts`.

### Tests

Mock `octokit.rest.issues.update` and verify:
- Success case returns `{ success: true, state: "closed" | "open" }`
- Missing repo config returns error
- Missing token returns error
- API error propagates with message

---

## 2. Rate Limiting Enhancements

### Problem

The existing rate limiter returns plain 429 responses without standard headers. Limits are hardcoded and some endpoints lack protection.

### Approach

Enhance the inline `rateLimiter` function in `src/webapp.ts` to add headers and env-configurable limits.

### Files

| File | Action |
|------|--------|
| `src/webapp.ts` | Update rate limiter and add env config |

### Changes

#### Environment Variables

```
RATE_LIMIT_DEFAULT=100    # General fallback
RATE_LIMIT_RUN=20         # /run endpoint
RATE_LIMIT_CHAT=20        # /v1/chat/completions
RATE_LIMIT_WEBHOOK=60     # /webhook/*
RATE_LIMIT_HEALTH=120     # /health, /info, /dashboard/*, /metrics
```

Read via `parseInt(process.env.RATE_LIMIT_XXX || "default", 10)`.

#### Enhanced Rate Limiter

```typescript
const rateLimiter = (limitPerMinute: number) => async (c: any, next: any) => {
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
  const path = c.req.path;
  const key = `${ip}:${path}`;

  const count = rateLimitCache.get(key) || 0;

  // Always set rate limit headers
  c.header("X-RateLimit-Limit", String(limitPerMinute));
  c.header("X-RateLimit-Remaining", String(Math.max(0, limitPerMinute - count - 1)));

  if (count >= limitPerMinute) {
    const retryAfter = 60; // seconds (matches TTL window)
    c.header("Retry-After", String(retryAfter));
    return c.json({ error: "Too Many Requests", retry_after: retryAfter }, 429);
  }

  rateLimitCache.set(key, count + 1);
  await next();
};
```

#### New Endpoint Coverage

Add rate limiting to currently unprotected endpoints:

```typescript
app.use("/health", rateLimiter(rateLimitHealth));
app.use("/info", rateLimiter(rateLimitHealth));
app.use("/dashboard/*", rateLimiter(rateLimitHealth));
app.use("/metrics", rateLimiter(rateLimitHealth));
```

### Environment Setup

Add to `.env.example`:
```
RATE_LIMIT_DEFAULT=100
RATE_LIMIT_RUN=20
RATE_LIMIT_CHAT=20
RATE_LIMIT_WEBHOOK=60
RATE_LIMIT_HEALTH=120
```

---

## 3. Sandbox Grep Improvements

### Problem

The existing `sandbox_grep` tool searches all files without filtering. It can match binary files, log files, or `node_modules`, producing noisy results.

### Approach

Add `include`, `exclude`, and `maxFileSize` parameters to the tool schema.

### Files

| File | Action |
|------|--------|
| `src/tools/sandbox-files.ts` | Update `sandboxGrepTool` |
| `src/tools/__tests__/sandbox-files.test.ts` | Add grep-specific tests |

### New Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `include` | `string` (optional) | none | Glob pattern for files to include (e.g., `*.ts`) |
| `exclude` | `string` (optional) | none | Glob pattern for files to exclude (e.g., `*.log`) |
| `maxFileSize` | `number` (optional) | 1048576 (1MB) | Skip files larger than this many bytes |

### Implementation

The grep command construction changes:

```typescript
// Build grep command with filtering
const grepArgs: string[] = [];

if (include) {
  grepArgs.push(`--include=${shellEscapeSingleQuotes(include)}`);
}

if (exclude) {
  grepArgs.push(`--exclude=${shellEscapeSingleQuotes(exclude)}`);
}

// Always skip binary files
grepArgs.push("--binary-files=without-match");

// ... existing flags (caseInsensitive, recursive, lineNumbers, etc.)

// For maxFileSize, use find to pre-filter, then pipe to grep
if (maxFileSize) {
  const findCmd = `find ${shellEscapeSingleQuotes(searchPath)} -type f -size -${maxFileSize}c`;
  const cmd = `${findCmd} | xargs grep ${grepArgs.join(" ")} ${shellEscapeSingleQuotes(pattern)}`;
  // ...
} else {
  const cmd = `grep ${grepArgs.join(" ")} ${shellEscapeSingleQuotes(pattern)} ${shellEscapeSingleQuotes(searchPath)}`;
  // ...
}
```

### Tests

- Grep with `include: "*.ts"` only searches `.ts` files
- Grep with `exclude: "*.log"` skips `.log` files
- Grep with `maxFileSize` skips large files
- Grep still works without new parameters (backward compatible)

---

## 4. Artifact Update Improvements

### Problem

The artifact update tool only supports full content replacement. There is no size validation, no append/prepend support, and no tests.

### Approach

Add `mode` parameter, size validation, and comprehensive tests.

### Files

| File | Action |
|------|--------|
| `src/utils/memory-pointer.ts` | Update `updateArtifact()` to support modes |
| `src/tools/artifact-query.ts` | Update `artifactUpdateTool` schema and logic |
| `src/tools/__tests__/artifact-update.test.ts` | New test file |

### Mode Parameter

| Mode | Behavior |
|------|----------|
| `replace` (default) | Replace entire content (current behavior) |
| `append` | Concatenate new content after existing content |
| `prepend` | Insert new content before existing content |

When `mode` is `append` or `prepend`, the separator is `"\n"`.

### Size Validation

Before applying an update, validate that the resulting content would not exceed `MAX_POINTER_SIZE_TOKENS` (estimated as `content.length / 4`).

```typescript
const estimatedTokens = newContent.length / 4;
if (estimatedTokens > MAX_POINTER_SIZE_TOKENS) {
  return JSON.stringify({
    error: "Content exceeds maximum size",
    estimated_tokens: Math.round(estimatedTokens),
    max_tokens: MAX_POINTER_SIZE_TOKENS,
  });
}
```

### Updated Tool Schema

```typescript
schema: z.object({
  pointer_id: z.string().describe("The pointer ID to update"),
  content: z.string().optional().describe("New content"),
  metadata: z.record(z.string(), z.any()).optional().describe("Metadata to merge"),
  type: z.string().optional().describe("New artifact type"),
  mode: z.enum(["replace", "append", "prepend"]).optional().default("replace")
    .describe("Update mode: replace (default), append, or prepend content"),
}),
```

### Tests

- Replace mode: content is fully replaced
- Append mode: new content appended with newline separator
- Prepend mode: new content prepended with newline separator
- Size validation: content exceeding max returns error
- Metadata merge: new metadata merged with existing
- Thread ownership: wrong thread_id returns error
- Missing pointer_id format validation
