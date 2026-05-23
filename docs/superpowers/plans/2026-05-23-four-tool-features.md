# Four Tool Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add close/reopen GitHub issue tools, enhance rate limiting with headers and env config, improve sandbox grep with file filtering, and add append/prepend modes to artifact update.

**Architecture:** Each feature is independent and touches different files. Close/reopen issues follows the existing `comment-github-issue.ts` pattern. Rate limiting enhances the inline webapp middleware. Sandbox grep adds new schema params. Artifact update adds a `mode` field and size validation.

**Tech Stack:** TypeScript, Bun test runner, LangChain tools, Hono web framework, Octokit, Zod

---

## Task 1: Close GitHub Issue — API Function

**Files:**
- Modify: `src/utils/github/api.ts:555-556` (append after `createGithubIssue`)
- Modify: `src/utils/github/index.ts:82-88` (add exports)

- [ ] **Step 1: Add `closeGithubIssue` to `src/utils/github/api.ts`**

Append after the `createGithubIssue` function (after line 555):

```typescript
export async function closeGithubIssue(
  repoOwner: string,
  repoName: string,
  githubToken: string,
  issueNumber: number,
): Promise<{ url: string | null; number: number | null; state: string }> {
  const octokit = new Octokit({ auth: githubToken });

  logger.info(
    { repo: `${repoOwner}/${repoName}`, issueNumber },
    "[github] Closing issue",
  );

  const { data: issue } = await octokit.rest.issues.update({
    owner: repoOwner,
    repo: repoName,
    issue_number: issueNumber,
    state: "closed",
  });

  invalidateRepoCache(repoOwner, repoName);

  logger.info(
    { issueUrl: issue.html_url, issueNumber: issue.number, state: issue.state },
    "[github] Issue closed successfully",
  );

  return {
    url: issue.html_url ?? null,
    number: issue.number ?? null,
    state: issue.state,
  };
}
```

- [ ] **Step 2: Export `closeGithubIssue` from `src/utils/github/index.ts`**

Update the export block at line 82-88 to include `closeGithubIssue`:

```typescript
export {
  createGithubPr,
  createGithubIssue,
  closeGithubIssue,
  findExistingPr,
  listGithubPrs,
  mergeGithubPr,
  getGithubDefaultBranch,
} from "./api";
```

- [ ] **Step 3: Commit**

```bash
git add src/utils/github/api.ts src/utils/github/index.ts
git commit -m "feat: add closeGithubIssue API function"
```

---

## Task 2: Close GitHub Issue — Tool

**Files:**
- Create: `src/tools/close-github-issue.ts`
- Modify: `src/tools/index.ts` (register tool)

- [ ] **Step 1: Create `src/tools/close-github-issue.ts`**

```typescript
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { closeGithubIssue } from "../utils/github/index";
import { createLogger } from "../utils/logger";

const logger = createLogger("close-github-issue-tool");

export const closeGithubIssueTool = tool(
  async ({ issue_number }, config) => {
    const repoOwner = config?.configurable?.repo?.owner;
    const repoName = config?.configurable?.repo?.name;
    const githubToken = process.env.GITHUB_TOKEN || "";

    if (!repoOwner || !repoName) {
      return JSON.stringify({
        success: false,
        error:
          "Repository configuration missing. Use --repo owner/name to specify a repository.",
      });
    }

    if (!githubToken) {
      return JSON.stringify({
        success: false,
        error:
          "Missing GITHUB_TOKEN in host environment. Cannot close issues without authentication.",
      });
    }

    try {
      const result = await closeGithubIssue(
        repoOwner,
        repoName,
        githubToken,
        issue_number,
      );

      if (result.url && result.number) {
        const response = {
          success: true,
          issue_url: result.url,
          issue_number: result.number,
          state: result.state,
        };
        const jsonString = JSON.stringify(response);
        const citationReminder = `\n\nIMPORTANT: When responding to the user, reference the closed issue as "Issue #${result.number}" or include its URL: ${result.url}`;
        return jsonString + citationReminder;
      } else {
        return JSON.stringify({
          success: false,
          error: "Failed to close issue. No URL or number returned.",
        });
      }
    } catch (error: any) {
      const status = error?.status ?? error?.response?.status ?? null;
      const message =
        error?.response?.data?.message ||
        error?.message ||
        "Failed to close issue";

      return JSON.stringify({
        success: false,
        error: message,
        status,
        issue_number,
      });
    }
  },
  {
    name: "close_github_issue",
    description:
      "Close a GitHub issue. Returns the issue URL and updated state upon success.",
    schema: z.object({
      issue_number: z
        .number()
        .int()
        .positive()
        .describe("Issue number to close"),
    }),
  },
);
```

- [ ] **Step 2: Register in `src/tools/index.ts`**

Add the import at line 8 (after the `comment-github-issue` import):

```typescript
import { closeGithubIssueTool } from "./close-github-issue";
```

Add `closeGithubIssueTool` to the `allToolsUncompressed` array (after `commentGithubIssueTool` at line 52).

- [ ] **Step 3: Commit**

```bash
git add src/tools/close-github-issue.ts src/tools/index.ts
git commit -m "feat: add close_github_issue tool"
```

---

## Task 3: Close GitHub Issue — Tests

**Files:**
- Create: `src/tools/__tests__/close-github-issue.test.ts`

- [ ] **Step 1: Create test file**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spyOn } from "bun:test";
import * as github from "../../utils/github";
import { closeGithubIssueTool } from "../close-github-issue";

describe("closeGithubIssueTool", () => {
  const originalEnv = process.env;
  let mockCloseGithubIssue: any;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockCloseGithubIssue = spyOn(github, "closeGithubIssue").mockResolvedValue({
      url: "https://github.com/test-owner/test-repo/issues/42",
      number: 42,
      state: "closed",
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    if (mockCloseGithubIssue) mockCloseGithubIssue.mockRestore();
  });

  const validConfig = {
    configurable: {
      thread_id: "test-thread",
      repo: { owner: "test-owner", name: "test-repo" },
    },
  };

  const validArgs = { issue_number: 42 };

  it("should return error if repo owner is missing", async () => {
    const resultJson = await closeGithubIssueTool.invoke(validArgs, {
      configurable: {
        thread_id: "test-thread",
        repo: { name: "test-repo" },
      },
    } as any);

    const result = JSON.parse(resultJson as string);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Repository configuration missing");
  });

  it("should return error if repo name is missing", async () => {
    const resultJson = await closeGithubIssueTool.invoke(validArgs, {
      configurable: {
        thread_id: "test-thread",
        repo: { owner: "test-owner" },
      },
    } as any);

    const result = JSON.parse(resultJson as string);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Repository configuration missing");
  });

  it("should return error if GITHUB_TOKEN is missing", async () => {
    delete process.env.GITHUB_TOKEN;

    const resultJson = await closeGithubIssueTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing GITHUB_TOKEN");
    expect(mockCloseGithubIssue).not.toHaveBeenCalled();
  });

  it("should close issue with GITHUB_TOKEN from env", async () => {
    process.env.GITHUB_TOKEN = "env_token";

    const resultJson = await closeGithubIssueTool.invoke(validArgs, validConfig as any);
    const jsonMatch = (resultJson as string).match(/\{[\s\S]*?\}/);
    const result = JSON.parse(jsonMatch ? jsonMatch[0] : (resultJson as string));

    expect(result.success).toBe(true);
    expect(result.issue_url).toBe("https://github.com/test-owner/test-repo/issues/42");
    expect(result.issue_number).toBe(42);
    expect(result.state).toBe("closed");
    expect(mockCloseGithubIssue).toHaveBeenCalledWith(
      "test-owner",
      "test-repo",
      "env_token",
      42,
    );
  });

  it("should include citation reminder in response", async () => {
    process.env.GITHUB_TOKEN = "env_token";

    const resultJson = await closeGithubIssueTool.invoke(validArgs, validConfig as any);

    expect(resultJson).toContain("IMPORTANT: When responding to the user");
    expect(resultJson).toContain("Issue #42");
    expect(resultJson).toContain("https://github.com/test-owner/test-repo/issues/42");
  });

  it("should return error if API call throws", async () => {
    process.env.GITHUB_TOKEN = "env_token";
    mockCloseGithubIssue.mockRejectedValue(new Error("Not Found"));

    const resultJson = await closeGithubIssueTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Not Found");
  });

  it("should extract status from error if available", async () => {
    process.env.GITHUB_TOKEN = "env_token";
    const error: any = new Error("Unauthorized");
    error.status = 401;
    mockCloseGithubIssue.mockRejectedValue(error);

    const resultJson = await closeGithubIssueTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `bun test src/tools/__tests__/close-github-issue.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/tools/__tests__/close-github-issue.test.ts
git commit -m "test: add close_github_issue tool tests"
```

---

## Task 4: Reopen GitHub Issue — API Function + Tool + Tests

**Files:**
- Modify: `src/utils/github/api.ts` (append after `closeGithubIssue`)
- Modify: `src/utils/github/index.ts` (add export)
- Create: `src/tools/reopen-github-issue.ts`
- Modify: `src/tools/index.ts` (register tool)
- Create: `src/tools/__tests__/reopen-github-issue.test.ts`

This task follows the exact same pattern as Tasks 1-3 but for reopening.

- [ ] **Step 1: Add `reopenGithubIssue` to `src/utils/github/api.ts`**

Append after `closeGithubIssue`:

```typescript
export async function reopenGithubIssue(
  repoOwner: string,
  repoName: string,
  githubToken: string,
  issueNumber: number,
): Promise<{ url: string | null; number: number | null; state: string }> {
  const octokit = new Octokit({ auth: githubToken });

  logger.info(
    { repo: `${repoOwner}/${repoName}`, issueNumber },
    "[github] Reopening issue",
  );

  const { data: issue } = await octokit.rest.issues.update({
    owner: repoOwner,
    repo: repoName,
    issue_number: issueNumber,
    state: "open",
  });

  invalidateRepoCache(repoOwner, repoName);

  logger.info(
    { issueUrl: issue.html_url, issueNumber: issue.number, state: issue.state },
    "[github] Issue reopened successfully",
  );

  return {
    url: issue.html_url ?? null,
    number: issue.number ?? null,
    state: issue.state,
  };
}
```

- [ ] **Step 2: Export `reopenGithubIssue` from `src/utils/github/index.ts`**

Add `reopenGithubIssue` to the export block from `"./api"`:

```typescript
export {
  createGithubPr,
  createGithubIssue,
  closeGithubIssue,
  reopenGithubIssue,
  findExistingPr,
  listGithubPrs,
  mergeGithubPr,
  getGithubDefaultBranch,
} from "./api";
```

- [ ] **Step 3: Create `src/tools/reopen-github-issue.ts`**

```typescript
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { reopenGithubIssue } from "../utils/github/index";
import { createLogger } from "../utils/logger";

const logger = createLogger("reopen-github-issue-tool");

export const reopenGithubIssueTool = tool(
  async ({ issue_number }, config) => {
    const repoOwner = config?.configurable?.repo?.owner;
    const repoName = config?.configurable?.repo?.name;
    const githubToken = process.env.GITHUB_TOKEN || "";

    if (!repoOwner || !repoName) {
      return JSON.stringify({
        success: false,
        error:
          "Repository configuration missing. Use --repo owner/name to specify a repository.",
      });
    }

    if (!githubToken) {
      return JSON.stringify({
        success: false,
        error:
          "Missing GITHUB_TOKEN in host environment. Cannot reopen issues without authentication.",
      });
    }

    try {
      const result = await reopenGithubIssue(
        repoOwner,
        repoName,
        githubToken,
        issue_number,
      );

      if (result.url && result.number) {
        const response = {
          success: true,
          issue_url: result.url,
          issue_number: result.number,
          state: result.state,
        };
        const jsonString = JSON.stringify(response);
        const citationReminder = `\n\nIMPORTANT: When responding to the user, reference the reopened issue as "Issue #${result.number}" or include its URL: ${result.url}`;
        return jsonString + citationReminder;
      } else {
        return JSON.stringify({
          success: false,
          error: "Failed to reopen issue. No URL or number returned.",
        });
      }
    } catch (error: any) {
      const status = error?.status ?? error?.response?.status ?? null;
      const message =
        error?.response?.data?.message ||
        error?.message ||
        "Failed to reopen issue";

      return JSON.stringify({
        success: false,
        error: message,
        status,
        issue_number,
      });
    }
  },
  {
    name: "reopen_github_issue",
    description:
      "Reopen a closed GitHub issue. Returns the issue URL and updated state upon success.",
    schema: z.object({
      issue_number: z
        .number()
        .int()
        .positive()
        .describe("Issue number to reopen"),
    }),
  },
);
```

- [ ] **Step 4: Register in `src/tools/index.ts`**

Add the import (after the `close-github-issue` import):

```typescript
import { reopenGithubIssueTool } from "./reopen-github-issue";
```

Add `reopenGithubIssueTool` to the `allToolsUncompressed` array (after `closeGithubIssueTool`).

- [ ] **Step 5: Create `src/tools/__tests__/reopen-github-issue.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spyOn } from "bun:test";
import * as github from "../../utils/github";
import { reopenGithubIssueTool } from "../reopen-github-issue";

describe("reopenGithubIssueTool", () => {
  const originalEnv = process.env;
  let mockReopenGithubIssue: any;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockReopenGithubIssue = spyOn(github, "reopenGithubIssue").mockResolvedValue({
      url: "https://github.com/test-owner/test-repo/issues/42",
      number: 42,
      state: "open",
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    if (mockReopenGithubIssue) mockReopenGithubIssue.mockRestore();
  });

  const validConfig = {
    configurable: {
      thread_id: "test-thread",
      repo: { owner: "test-owner", name: "test-repo" },
    },
  };

  const validArgs = { issue_number: 42 };

  it("should return error if repo config is missing", async () => {
    const resultJson = await reopenGithubIssueTool.invoke(validArgs, {
      configurable: { thread_id: "test-thread" },
    } as any);

    const result = JSON.parse(resultJson as string);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Repository configuration missing");
  });

  it("should return error if GITHUB_TOKEN is missing", async () => {
    delete process.env.GITHUB_TOKEN;

    const resultJson = await reopenGithubIssueTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing GITHUB_TOKEN");
    expect(mockReopenGithubIssue).not.toHaveBeenCalled();
  });

  it("should reopen issue with GITHUB_TOKEN from env", async () => {
    process.env.GITHUB_TOKEN = "env_token";

    const resultJson = await reopenGithubIssueTool.invoke(validArgs, validConfig as any);
    const jsonMatch = (resultJson as string).match(/\{[\s\S]*?\}/);
    const result = JSON.parse(jsonMatch ? jsonMatch[0] : (resultJson as string));

    expect(result.success).toBe(true);
    expect(result.issue_number).toBe(42);
    expect(result.state).toBe("open");
    expect(mockReopenGithubIssue).toHaveBeenCalledWith(
      "test-owner",
      "test-repo",
      "env_token",
      42,
    );
  });

  it("should include citation reminder in response", async () => {
    process.env.GITHUB_TOKEN = "env_token";

    const resultJson = await reopenGithubIssueTool.invoke(validArgs, validConfig as any);

    expect(resultJson).toContain("IMPORTANT: When responding to the user");
    expect(resultJson).toContain("Issue #42");
  });

  it("should return error if API call throws", async () => {
    process.env.GITHUB_TOKEN = "env_token";
    mockReopenGithubIssue.mockRejectedValue(new Error("Not Found"));

    const resultJson = await reopenGithubIssueTool.invoke(validArgs, validConfig as any);
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Not Found");
  });
});
```

- [ ] **Step 6: Run all new tests**

Run: `bun test src/tools/__tests__/close-github-issue.test.ts src/tools/__tests__/reopen-github-issue.test.ts`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/utils/github/api.ts src/utils/github/index.ts src/tools/reopen-github-issue.ts src/tools/index.ts src/tools/__tests__/reopen-github-issue.test.ts
git commit -m "feat: add reopen_github_issue tool and API function"
```

---

## Task 5: Rate Limiting Enhancements

**Files:**
- Modify: `src/webapp.ts:16-35` (rate limiter function)
- Modify: `src/webapp.ts:174-177` (rate limit registrations)
- Modify: `.env.example` (add rate limit env vars)

- [ ] **Step 1: Update rate limiter in `src/webapp.ts`**

Replace lines 16-35 with:

```typescript
// In-memory rate limiter with configurable limits
const rateLimitCache = new LRUCache<string, number>({
  max: 5000,
  ttl: 60 * 1000, // 1 minute window
});

// Configurable rate limits from environment
const rateLimitRun = Number.parseInt(process.env.RATE_LIMIT_RUN || "20", 10);
const rateLimitChat = Number.parseInt(process.env.RATE_LIMIT_CHAT || "20", 10);
const rateLimitWebhook = Number.parseInt(process.env.RATE_LIMIT_WEBHOOK || "60", 10);
const rateLimitHealth = Number.parseInt(process.env.RATE_LIMIT_HEALTH || "120", 10);

const rateLimiter = (limitPerMinute: number) => async (c: any, next: any) => {
  const ip =
    c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
  const path = c.req.path;
  const key = `${ip}:${path}`;

  const count = rateLimitCache.get(key) || 0;

  // Set rate limit headers on every response
  c.header("X-RateLimit-Limit", String(limitPerMinute));
  c.header("X-RateLimit-Remaining", String(Math.max(0, limitPerMinute - count - 1)));

  if (count >= limitPerMinute) {
    const retryAfter = 60;
    c.header("Retry-After", String(retryAfter));
    log.warn({ ip, path, limit: limitPerMinute }, "[webapp] Rate limit exceeded");
    return c.json({ error: "Too Many Requests", retry_after: retryAfter }, 429);
  }

  rateLimitCache.set(key, count + 1);
  await next();
};
```

- [ ] **Step 2: Update rate limit registrations in `src/webapp.ts`**

Replace the hardcoded values at lines 174-177:

```typescript
// Apply rate limits to public webhooks and expensive endpoints
app.use("/webhook/*", rateLimiter(rateLimitWebhook));
app.use("/run", rateLimiter(rateLimitRun));
app.use("/v1/chat/completions", rateLimiter(rateLimitChat));
app.use("/health", rateLimiter(rateLimitHealth));
app.use("/info", rateLimiter(rateLimitHealth));
app.use("/dashboard/*", rateLimiter(rateLimitHealth));
app.use("/metrics", rateLimiter(rateLimitHealth));
app.use("/metrics/*", rateLimiter(rateLimitHealth));
```

- [ ] **Step 3: Add env vars to `.env.example`**

Append to `.env.example`:

```
# Rate limiting (requests per minute per IP)
# RATE_LIMIT_RUN=20
# RATE_LIMIT_CHAT=20
# RATE_LIMIT_WEBHOOK=60
# RATE_LIMIT_HEALTH=120
```

- [ ] **Step 4: Run TypeScript check**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/webapp.ts .env.example
git commit -m "feat: add rate limit headers, env config, and broader endpoint coverage"
```

---

## Task 6: Sandbox Grep — File Filtering

**Files:**
- Modify: `src/tools/sandbox-files.ts:551-681` (`sandboxGrepTool`)
- Modify: `src/tools/__tests__/sandbox-files.test.ts` (add new tests)

- [ ] **Step 1: Update `sandboxGrepTool` in `src/tools/sandbox-files.ts`**

Replace the entire `sandboxGrepTool` (lines 551-681) with:

```typescript
export const sandboxGrepTool = tool(
  async (
    {
      pattern,
      path,
      caseInsensitive,
      recursive,
      lineNumbers,
      contextLines,
      maxMatches,
      include,
      exclude,
      maxFileSize,
    }: {
      pattern: string;
      path?: string;
      caseInsensitive?: boolean;
      recursive?: boolean;
      lineNumbers?: boolean;
      contextLines?: number;
      maxMatches?: number;
      include?: string;
      exclude?: string;
      maxFileSize?: number;
    },
    config,
  ) => {
    const backend = getSandboxBackendFromConfig(config);
    if (!backend) {
      throw new Error(
        "Sandbox backend not initialized. Make sure USE_SANDBOX=true is set.",
      );
    }

    const searchPath = path || "/workspace";
    logger.debug(
      { path: searchPath, pattern, caseInsensitive, recursive, include, exclude },
      "[sandbox-grep] Searching content",
    );

    try {
      const flags: string[] = [];

      if (caseInsensitive) {
        flags.push("-i");
      }

      if (recursive) {
        flags.push("-r");
      }

      if (lineNumbers) {
        flags.push("-n");
      }

      if (contextLines !== undefined) {
        flags.push(`-C ${contextLines}`);
      }

      if (maxMatches !== undefined) {
        flags.push(`-m ${maxMatches}`);
      }

      if (include) {
        flags.push(`--include=${shellEscapeSingleQuotes(include)}`);
      }

      if (exclude) {
        flags.push(`--exclude=${shellEscapeSingleQuotes(exclude)}`);
      }

      // Always skip binary files
      flags.push("--binary-files=without-match");

      const flagsStr = flags.join(" ");

      let result;
      const effectiveMaxSize = maxFileSize ?? 1048576; // 1MB default

      if (effectiveMaxSize > 0) {
        // Use find to pre-filter by size, then pipe to grep
        const findCmd = `find ${shellEscapeSingleQuotes(searchPath)} -type f -size -${effectiveMaxSize}c`;
        result = await backend.execute(
          `${findCmd} | xargs grep ${flagsStr} ${shellEscapeSingleQuotes(pattern)}`,
        );
      } else {
        result = await backend.execute(
          `grep ${flagsStr} ${shellEscapeSingleQuotes(pattern)} ${shellEscapeSingleQuotes(searchPath)}`,
        );
      }

      if (result.exitCode !== 0 && result.exitCode !== 1) {
        return {
          path: searchPath,
          pattern,
          matches: [],
          count: 0,
          error: result.output,
        };
      }

      const lines = result.output
        .split("\n")
        .filter((line: string) => line.trim())
        .map((line: string) => line.trim());

      return {
        path: searchPath,
        pattern,
        matches: lines,
        count: lines.length,
      };
    } catch (err) {
      logger.error({ error: err }, "[sandbox-grep] Failed to search content");
      throw err;
    }
  },
  {
    name: "sandbox_grep",
    description:
      "Search for text patterns within files in the sandbox. " +
      "Similar to the Unix 'grep' command. " +
      "Useful for finding specific content, function definitions, or text patterns in code. " +
      "Supports file type filtering with include/exclude globs and binary file skipping.",
    schema: z.object({
      pattern: z
        .string()
        .describe("Text pattern or regex to search for"),
      path: z
        .string()
        .optional()
        .default("/workspace")
        .describe("Directory or file to search in"),
      caseInsensitive: z
        .boolean()
        .optional()
        .default(false)
        .describe("Perform case-insensitive search"),
      recursive: z
        .boolean()
        .optional()
        .default(true)
        .describe("Search recursively in subdirectories"),
      lineNumbers: z
        .boolean()
        .optional()
        .default(true)
        .describe("Show line numbers in output"),
      contextLines: z
        .number()
        .optional()
        .describe("Number of context lines to show (like -C flag)"),
      maxMatches: z
        .number()
        .optional()
        .describe("Maximum number of matches to return"),
      include: z
        .string()
        .optional()
        .describe("Glob pattern for files to include (e.g., '*.ts', '*.py')"),
      exclude: z
        .string()
        .optional()
        .describe("Glob pattern for files to exclude (e.g., '*.log', 'node_modules')"),
      maxFileSize: z
        .number()
        .optional()
        .describe("Skip files larger than this many bytes (default: 1048576 = 1MB)"),
    }),
  },
);
```

- [ ] **Step 2: Add grep filtering tests to `src/tools/__tests__/sandbox-files.test.ts`**

Append inside the `sandboxGrepTool` describe block (before its closing `});`):

```typescript
      test("searches with include filter", async () => {
        mockExecute.mockResolvedValue({ exitCode: 0, output: "/workspace/file.ts:const x = 1" });
        const result = await sandboxGrepTool.invoke({
          pattern: "const",
          path: "/workspace",
          include: "*.ts",
        }, validConfig);

        expect(result).toEqual({
          path: "/workspace",
          pattern: "const",
          matches: ["/workspace/file.ts:const x = 1"],
          count: 1,
        });
        const actualCall = mockExecute.mock.calls[0][0];
        expect(actualCall).toContain("--include='*.ts'");
        expect(actualCall).toContain("--binary-files=without-match");
      });

      test("searches with exclude filter", async () => {
        mockExecute.mockResolvedValue({ exitCode: 0, output: "/workspace/file.ts:match" });
        const result = await sandboxGrepTool.invoke({
          pattern: "test",
          path: "/workspace",
          exclude: "*.log",
        }, validConfig);

        expect(result.count).toBe(1);
        const actualCall = mockExecute.mock.calls[0][0];
        expect(actualCall).toContain("--exclude='*.log'");
      });

      test("searches with maxFileSize uses find pipe", async () => {
        mockExecute.mockResolvedValue({ exitCode: 0, output: "/workspace/small.txt:match" });
        const result = await sandboxGrepTool.invoke({
          pattern: "test",
          path: "/workspace",
          maxFileSize: 1024,
        }, validConfig);

        expect(result.count).toBe(1);
        const actualCall = mockExecute.mock.calls[0][0];
        expect(actualCall).toContain("find '/workspace' -type f -size -1024c");
        expect(actualCall).toContain("| xargs grep");
      });

      test("always skips binary files", async () => {
        mockExecute.mockResolvedValue({ exitCode: 0, output: "match" });
        await sandboxGrepTool.invoke({
          pattern: "test",
          path: "/workspace",
        }, validConfig);

        const actualCall = mockExecute.mock.calls[0][0];
        expect(actualCall).toContain("--binary-files=without-match");
      });

      test("backward compatible without new params", async () => {
        mockExecute.mockResolvedValue({ exitCode: 0, output: "/workspace/file.ts:match" });
        const result = await sandboxGrepTool.invoke({
          pattern: "test",
          path: "/workspace",
        }, validConfig);

        expect(result.count).toBe(1);
        const actualCall = mockExecute.mock.calls[0][0];
        expect(actualCall).toContain("find '/workspace' -type f -size -1048576c");
        expect(actualCall).toContain("| xargs grep");
      });
```

- [ ] **Step 3: Update existing grep test assertions**

The existing grep tests in `sandbox-files.test.ts` assert the exact command format. Since the new implementation always uses `find ... | xargs grep ...` (because of the default 1MB maxFileSize), update these existing test assertions:

1. The `"successfully searches for pattern with matches"` test — change the regex assertion:
   ```typescript
   // Old: expect(actualCall).toMatch(/grep.*'test'.*'\/workspace'/);
   // New:
   expect(actualCall).toContain("find '/workspace' -type f");
   expect(actualCall).toContain("| xargs grep");
   expect(actualCall).toContain("'test'");
   ```

2. The `"uses default path when not provided"` test — the `expect(actualCall).toContain("'/workspace'")` still works because `find '/workspace'` contains it.

3. All other flag-based assertions (`-i`, `-r`, `-n`, `-C`, `-m`) still work because those flags remain in the grep portion of the piped command.

- [ ] **Step 4: Run tests**

Run: `bun test src/tools/__tests__/sandbox-files.test.ts`
Expected: All tests PASS (existing tests updated for new command format + new tests pass)

- [ ] **Step 5: Commit**

```bash
git add src/tools/sandbox-files.ts src/tools/__tests__/sandbox-files.test.ts
git commit -m "feat: add include/exclude/maxFileSize filters to sandbox_grep"
```

---

## Task 7: Artifact Update — Add Mode Support to API

**Files:**
- Modify: `src/utils/memory-pointer.ts:67-71` (`UpdateOptions` interface)
- Modify: `src/utils/memory-pointer.ts:285-370` (`updateArtifact` function)

- [ ] **Step 1: Update `UpdateOptions` interface in `src/utils/memory-pointer.ts`**

Replace the interface at lines 67-71:

```typescript
export interface UpdateOptions {
  content?: string;
  metadata?: Record<string, unknown>;
  type?: string;
  mode?: "replace" | "append" | "prepend";
}
```

- [ ] **Step 2: Update `updateArtifact` function body in `src/utils/memory-pointer.ts`**

Replace the content update block at lines 327-329:

```typescript
    // Update content if provided
    if (options.content !== undefined) {
      const mode = options.mode ?? "replace";
      switch (mode) {
        case "append":
          artifact.content = artifact.content + "\n" + options.content;
          break;
        case "prepend":
          artifact.content = options.content + "\n" + artifact.content;
          break;
        case "replace":
        default:
          artifact.content = options.content;
          break;
      }
    }
```

- [ ] **Step 3: Run TypeScript check**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/utils/memory-pointer.ts
git commit -m "feat: add append/prepend mode support to updateArtifact"
```

---

## Task 8: Artifact Update — Enhance Tool and Add Tests

**Files:**
- Modify: `src/tools/artifact-query.ts:268-401` (`artifactUpdateTool`)
- Create: `src/tools/__tests__/artifact-update.test.ts`

- [ ] **Step 1: Update `artifactUpdateTool` in `src/tools/artifact-query.ts`**

Replace the tool function (lines 268-401). Key changes:
- Add `mode` parameter to the destructured args
- Add `MAX_POINTER_SIZE_TOKENS` import and size validation
- Pass `mode` to `updateArtifact` options

Replace the async function body starting at line 269:

```typescript
  async ({ pointer_id, content, metadata, type, mode }, config) => {
    const threadId = config?.configurable?.thread_id;
    if (!threadId) {
      return JSON.stringify({
        error: "Missing thread_id",
      });
    }

    if (!pointer_id || !pointer_id.startsWith("ptr_")) {
      return JSON.stringify({
        error:
          "Invalid pointer_id format. Must start with 'ptr_' (e.g., 'ptr_abc123')",
      });
    }

    if (content === undefined && metadata === undefined && type === undefined) {
      return JSON.stringify({
        error:
          "At least one update field (content, metadata, or type) must be provided",
      });
    }

    // Size validation: estimate tokens from content length
    if (content !== undefined) {
      const estimatedTokens = Math.ceil(content.length / 4);
      if (estimatedTokens > MAX_POINTER_SIZE_TOKENS) {
        return JSON.stringify({
          error: "Content exceeds maximum size",
          estimated_tokens: estimatedTokens,
          max_tokens: MAX_POINTER_SIZE_TOKENS,
        });
      }
    }

    logger.info(
      { pointerId: pointer_id, threadId, hasContent: content !== undefined, hasMetadata: metadata !== undefined, hasType: type !== undefined, mode: mode ?? "replace" },
      "[artifact-update] Updating artifact",
    );

    try {
      const existingArtifact = await retrieveArtifact(pointer_id, threadId);
      if (!existingArtifact) {
        return JSON.stringify({
          error: "Artifact not found or access denied",
          pointer_id,
        });
      }

      const updateOptions: {
        content?: string;
        metadata?: Record<string, unknown>;
        type?: string;
        mode?: "replace" | "append" | "prepend";
      } = {};

      if (content !== undefined) {
        updateOptions.content = content;
        updateOptions.mode = mode ?? "replace";
      }

      if (metadata !== undefined) {
        updateOptions.metadata = metadata;
      }

      if (type !== undefined) {
        updateOptions.type = type;
      }

      const updatedArtifact = await updateArtifact(
        pointer_id,
        threadId,
        updateOptions,
      );

      if (!updatedArtifact) {
        return JSON.stringify({
          error: "Failed to update artifact. It may have expired.",
          pointer_id,
        });
      }

      logger.info(
        {
          pointerId: pointer_id,
          threadId,
          oldSize: existingArtifact.metadata.size,
          newSize: updatedArtifact.metadata.size,
        },
        "[artifact-update] Artifact updated successfully",
      );

      return JSON.stringify({
        success: true,
        pointer_id,
        message: "Artifact updated successfully",
        artifact: {
          id: updatedArtifact.metadata.id,
          type: updatedArtifact.metadata.type,
          size: updatedArtifact.metadata.size,
          size_formatted: `${updatedArtifact.metadata.size} characters`,
          token_count: updatedArtifact.metadata.tokenCount,
          timestamp: new Date(updatedArtifact.metadata.timestamp).toISOString(),
          metadata: updatedArtifact.metadata.metadata,
        },
      });
    } catch (error) {
      logger.error({ error, pointerId: pointer_id }, "[artifact-update] Update failed");

      return JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Unknown error occurred during artifact update",
        pointer_id,
      });
    }
  },
```

Update the schema to include `mode`:

```typescript
    schema: z.object({
      pointer_id: z
        .string()
        .describe("The pointer ID to update (e.g., 'ptr_abc123')"),
      content: z
        .string()
        .optional()
        .describe("New content to replace the existing content"),
      metadata: z
        .record(z.string(), z.any())
        .optional()
        .describe("Metadata to merge with existing metadata"),
      type: z
        .string()
        .optional()
        .describe("New artifact type"),
      mode: z
        .enum(["replace", "append", "prepend"])
        .optional()
        .default("replace")
        .describe("Update mode: replace (default), append, or prepend content"),
    }),
```

Also add the import at the top of the file (after the existing memory-pointer import line 6):

```typescript
import { MAX_POINTER_SIZE_TOKENS } from "../utils/memory-pointer";
```

Check if `MAX_POINTER_SIZE_TOKENS` is exported from `memory-pointer.ts`. If it is a module-level `const` (not exported), export it by adding `export` keyword:

```typescript
export const MAX_POINTER_SIZE_TOKENS = Number.parseInt(
  process.env.MAX_POINTER_SIZE_TOKENS || "5000",
  10,
);
```

- [ ] **Step 2: Create `src/tools/__tests__/artifact-update.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spyOn } from "bun:test";
import * as memoryPointer from "../../utils/memory-pointer";
import { artifactUpdateTool } from "../artifact-query";

describe("artifactUpdateTool", () => {
  let mockRetrieveArtifact: any;
  let mockUpdateArtifact: any;

  const validConfig = {
    configurable: { thread_id: "test-thread" },
  };

  const existingArtifact = {
    metadata: {
      id: "ptr_abc123",
      threadId: "test-thread",
      type: "code",
      size: 100,
      tokenCount: 25,
      timestamp: Date.now() - 1000,
      expiresAt: Date.now() + 86400000,
      metadata: {},
    },
    content: "original content",
  };

  const updatedArtifact = {
    metadata: {
      id: "ptr_abc123",
      threadId: "test-thread",
      type: "code",
      size: 200,
      tokenCount: 50,
      timestamp: Date.now(),
      expiresAt: Date.now() + 86400000,
      metadata: {},
    },
    content: "updated content",
  };

  beforeEach(() => {
    mockRetrieveArtifact = spyOn(memoryPointer, "retrieveArtifact")
      .mockResolvedValue(existingArtifact as any);
    mockUpdateArtifact = spyOn(memoryPointer, "updateArtifact")
      .mockResolvedValue(updatedArtifact as any);
  });

  afterEach(() => {
    if (mockRetrieveArtifact) mockRetrieveArtifact.mockRestore();
    if (mockUpdateArtifact) mockUpdateArtifact.mockRestore();
  });

  it("should return error if thread_id is missing", async () => {
    const resultJson = await artifactUpdateTool.invoke(
      { pointer_id: "ptr_abc123", content: "new" },
      { configurable: {} } as any,
    );
    const result = JSON.parse(resultJson as string);
    expect(result.error).toBe("Missing thread_id");
  });

  it("should return error for invalid pointer_id format", async () => {
    const resultJson = await artifactUpdateTool.invoke(
      { pointer_id: "invalid", content: "new" },
      validConfig as any,
    );
    const result = JSON.parse(resultJson as string);
    expect(result.error).toContain("Invalid pointer_id format");
  });

  it("should return error if no update fields provided", async () => {
    const resultJson = await artifactUpdateTool.invoke(
      { pointer_id: "ptr_abc123" },
      validConfig as any,
    );
    const result = JSON.parse(resultJson as string);
    expect(result.error).toContain("At least one update field");
  });

  it("should return error if artifact not found", async () => {
    mockRetrieveArtifact.mockResolvedValue(null);
    const resultJson = await artifactUpdateTool.invoke(
      { pointer_id: "ptr_abc123", content: "new" },
      validConfig as any,
    );
    const result = JSON.parse(resultJson as string);
    expect(result.error).toContain("Artifact not found or access denied");
  });

  it("should update with replace mode (default)", async () => {
    const resultJson = await artifactUpdateTool.invoke(
      { pointer_id: "ptr_abc123", content: "new content" },
      validConfig as any,
    );
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(true);
    expect(mockUpdateArtifact).toHaveBeenCalledWith(
      "ptr_abc123",
      "test-thread",
      expect.objectContaining({
        content: "new content",
        mode: "replace",
      }),
    );
  });

  it("should update with append mode", async () => {
    const resultJson = await artifactUpdateTool.invoke(
      { pointer_id: "ptr_abc123", content: "appended", mode: "append" },
      validConfig as any,
    );
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(true);
    expect(mockUpdateArtifact).toHaveBeenCalledWith(
      "ptr_abc123",
      "test-thread",
      expect.objectContaining({
        content: "appended",
        mode: "append",
      }),
    );
  });

  it("should update with prepend mode", async () => {
    const resultJson = await artifactUpdateTool.invoke(
      { pointer_id: "ptr_abc123", content: "prepended", mode: "prepend" },
      validConfig as any,
    );
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(true);
    expect(mockUpdateArtifact).toHaveBeenCalledWith(
      "ptr_abc123",
      "test-thread",
      expect.objectContaining({
        content: "prepended",
        mode: "prepend",
      }),
    );
  });

  it("should reject content exceeding max size", async () => {
    // Create content that exceeds MAX_POINTER_SIZE_TOKENS (5000 tokens = ~20000 chars)
    const hugeContent = "x".repeat(25000);
    const resultJson = await artifactUpdateTool.invoke(
      { pointer_id: "ptr_abc123", content: hugeContent },
      validConfig as any,
    );
    const result = JSON.parse(resultJson as string);

    expect(result.error).toBe("Content exceeds maximum size");
    expect(result.estimated_tokens).toBeDefined();
    expect(result.max_tokens).toBeDefined();
    expect(mockUpdateArtifact).not.toHaveBeenCalled();
  });

  it("should update metadata only", async () => {
    const resultJson = await artifactUpdateTool.invoke(
      { pointer_id: "ptr_abc123", metadata: { tag: "important" } },
      validConfig as any,
    );
    const result = JSON.parse(resultJson as string);

    expect(result.success).toBe(true);
    expect(mockUpdateArtifact).toHaveBeenCalledWith(
      "ptr_abc123",
      "test-thread",
      expect.objectContaining({
        metadata: { tag: "important" },
      }),
    );
  });

  it("should handle updateArtifact returning null", async () => {
    mockUpdateArtifact.mockResolvedValue(null);
    const resultJson = await artifactUpdateTool.invoke(
      { pointer_id: "ptr_abc123", content: "new" },
      validConfig as any,
    );
    const result = JSON.parse(resultJson as string);
    expect(result.error).toContain("Failed to update artifact");
  });
});
```

- [ ] **Step 3: Run tests**

Run: `bun test src/tools/__tests__/artifact-update.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/tools/artifact-query.ts src/utils/memory-pointer.ts src/tools/__tests__/artifact-update.test.ts
git commit -m "feat: add mode, size validation to artifact_update tool with tests"
```

---

## Task 9: Final Validation

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: All tests PASS

- [ ] **Step 2: Run TypeScript check**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify tool registration**

Run: `grep -n 'closeGithubIssueTool\|reopenGithubIssueTool' src/tools/index.ts`
Expected: Both appear in imports and in `allToolsUncompressed` array
