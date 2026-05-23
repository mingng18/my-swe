# Backoff Jitter + Webhook Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add jitter to Telegram backoff and extract webhook handlers into testable, independent modules.

**Architecture:** Two independent changes: (1) 3-line jitter addition to existing backoff in `src/index.ts`, (2) extract GitHub and Telegram webhook handlers from `src/webapp.ts` into `src/webhooks/github.ts` and `src/webhooks/telegram.ts`, leaving signature verification and route registration in webapp.ts.

**Tech Stack:** TypeScript, Bun test runner, Hono web framework

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/index.ts` | Modify | Add jitter to backoff delay calculation |
| `src/webhooks/github.ts` | Create | GitHub webhook event handler (pull_request, issues, push) |
| `src/webhooks/telegram.ts` | Create | Telegram webhook handler (message dedup, queue) |
| `src/webapp.ts` | Modify | Replace inline handlers with calls to extracted modules |
| `src/webhooks/__tests__/github.test.ts` | Create | Unit tests for GitHub webhook handler |
| `src/webhooks/__tests__/telegram.test.ts` | Create | Unit tests for Telegram webhook handler |
| `src/__tests__/webapp.test.ts` | Modify | Update imports after extraction |

---

### Task 1: Add jitter to Telegram backoff

**Files:**
- Modify: `src/index.ts:269-272`

- [ ] **Step 1: Write the failing test**

Add a test to `src/__tests__/webapp.test.ts` is not the right place — this is about the polling loop in `index.ts`. Since the jitter is a small inline computation (not a separate function), we'll make the edit directly and verify with a TypeScript check.

- [ ] **Step 2: Apply the jitter edit**

Replace the delay calculation in `src/index.ts` (lines 269-272):

```typescript
// Before:
      const delayMs = Math.min(
        baseDelayMs * Math.pow(2, consecutiveErrors - 1),
        maxDelayMs,
      );

// After:
      const baseDelay = Math.min(
        baseDelayMs * Math.pow(2, consecutiveErrors - 1),
        maxDelayMs,
      );
      const jitter = 0.75 + Math.random() * 0.5;
      const delayMs = Math.floor(baseDelay * jitter);
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add ±25% jitter to Telegram polling backoff"
```

---

### Task 2: Create `src/webhooks/github.ts`

**Files:**
- Create: `src/webhooks/github.ts`

- [ ] **Step 1: Create the webhooks directory**

```bash
mkdir -p src/webhooks/__tests__
```

- [ ] **Step 2: Write the GitHub webhook handler module**

Create `src/webhooks/github.ts` with the following content. This extracts the switch/case logic from `webapp.ts:477-684` into a standalone, testable function:

```typescript
import { createLogger } from "../utils/logger";
import {
  extractPrContext,
  fetchPrCommentsSinceLastTag,
  buildPrPrompt,
  reactToGithubComment,
  getThreadIdFromBranch,
  getGithubAppInstallationToken,
  storeGithubTokenInThread,
  postGithubComment,
  getGithubToken,
} from "../utils/github";
import { getEmailForIdentity } from "../utils/identity";
import { runCodeagentTurn } from "../server";

const log = createLogger("webhooks/github");

/**
 * Handle a GitHub webhook event.
 *
 * Processes pull_request, issues, and push events asynchronously.
 * Returns immediately — work runs in the background.
 */
export function handleGithubWebhook(
  payload: any,
  githubEvent: string,
): void {
  switch (githubEvent) {
    case "ping":
      break;

    case "pull_request":
    case "pull_request_review":
    case "pull_request_review_comment":
    case "issue_comment":
      handlePrEvent(payload, githubEvent);
      break;

    case "issues":
      handleIssuesEvent(payload);
      break;

    case "push":
      handlePushEvent(payload);
      break;

    default:
      log.info({ event: githubEvent }, "[github] Unhandled event");
  }
}

function handlePrEvent(payload: any, githubEvent: string): void {
  log.info(
    {
      action: payload.action,
      event: githubEvent,
      repository: payload.repository?.full_name,
    },
    "[github] PR event received",
  );

  void (async () => {
    try {
      if (githubEvent === "issue_comment" && !payload.issue?.pull_request) {
        return;
      }

      const [
        repoConfig,
        prNumber,
        branchName,
        githubLogin,
        prUrl,
        commentId,
        nodeId,
      ] = await extractPrContext(payload, githubEvent);

      if (!prNumber) {
        return;
      }

      const token =
        (await getGithubAppInstallationToken()) ||
        process.env.GITHUB_TOKEN?.trim() ||
        "";

      if (!token) {
        log.error(
          "[github] No GitHub token available to process PR event",
        );
        return;
      }

      const threadId = branchName
        ? await getThreadIdFromBranch(branchName)
        : null;
      if (threadId) {
        await storeGithubTokenInThread(threadId, token);
      }

      const comments = await fetchPrCommentsSinceLastTag(
        repoConfig,
        prNumber,
        token,
      );

      if (comments.length === 0) {
        return;
      }

      if (commentId) {
        await reactToGithubComment(
          repoConfig,
          commentId,
          githubEvent,
          token,
          prNumber,
          nodeId ?? undefined,
        );
      }

      const prompt = buildPrPrompt(comments, prUrl);

      const email =
        getEmailForIdentity("github", githubLogin) ||
        "No email found in identity map";

      const finalMessage = `[System Context: Webhook event ${githubEvent} from GitHub user @${githubLogin} (Email: ${email})]\n\n${prompt}`;

      await runCodeagentTurn(finalMessage, undefined, undefined, "github");
    } catch (err) {
      log.error({ err }, "[github] Background PR processing failed");
    }
  })();
}

function handleIssuesEvent(payload: any): void {
  const action = payload.action;
  const issue = payload.issue;
  const repository = payload.repository;

  log.info(
    {
      action,
      number: issue?.number,
      title: issue?.title,
    },
    "[github] Issue event",
  );

  if (action === "opened" && issue && repository) {
    const issueTitle = issue.title || "";
    const issueBody = issue.body || "";
    const repoOwner = repository.owner?.login;
    const repoName = repository.name;
    const issueNumber = issue.number;

    if (repoOwner && repoName && issueNumber) {
      void (async () => {
        try {
          const prompt = `New issue opened in ${repoOwner}/${repoName}#${issueNumber}:\nTitle: ${issueTitle}\n\n${issueBody}\n\nPlease analyze this issue and provide a helpful response.`;
          const reply = await runCodeagentTurn(
            prompt,
            undefined,
            undefined,
            "github",
          );

          const token =
            getGithubToken() || (await getGithubAppInstallationToken());
          if (token) {
            await postGithubComment(
              { owner: repoOwner, name: repoName },
              issueNumber,
              reply,
              token,
            );
            log.info({ issueNumber }, "[github] Posted reply to issue");
          } else {
            log.warn(
              "[github] No GitHub token available to post issue comment",
            );
          }
        } catch (err) {
          log.error({ err }, "[github] Error processing issue event");
        }
      })();
    }
  }
}

function handlePushEvent(payload: any): void {
  const repoName = payload.repository?.full_name || "unknown repository";
  const ref = payload.ref || "unknown ref";
  const commitsCount =
    payload.commits?.length || payload.push?.commits?.length || 0;

  log.info(
    {
      ref: payload.ref,
      commits: commitsCount,
    },
    "[github] Push event",
  );

  const input = `A push event was received on repository ${repoName} for ref ${ref} with ${commitsCount} commits.`;

  runCodeagentTurn(input, undefined, undefined, "github").catch((err) => {
    log.error({ error: err }, "[github] Error running agent on push event");
  });
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: No errors (the file is not yet imported anywhere, so it just needs to typecheck on its own)

- [ ] **Step 4: Commit**

```bash
git add src/webhooks/github.ts
git commit -m "feat: extract GitHub webhook handler into src/webhooks/github.ts"
```

---

### Task 3: Create `src/webhooks/telegram.ts`

**Files:**
- Create: `src/webhooks/telegram.ts`

- [ ] **Step 1: Write the Telegram webhook handler module**

This extracts the Telegram webhook handler from `webapp.ts:366-442`, including the message queue and thread management logic that lives in `webapp.ts:39-139`.

```typescript
import { createHash } from "crypto";
import { createLogger } from "../utils/logger";
import { runCodeagentTurn } from "../server";
import { loadTelegramConfig } from "../utils/config";
import { isDuplicateMessage, sendChatAction } from "../utils/telegram";

const log = createLogger("webhooks/telegram");

// Per-instance message queue for concurrent Telegram requests
interface QueueItem {
  chatId: number;
  text: string;
}
const messageQueue = new Map<string, QueueItem[]>();
const activeThreads = new Set<string>();

function generateThreadId(chatId: number): string {
  return createHash("sha256")
    .update(chatId.toString())
    .digest("hex")
    .substring(0, 16);
}

function enqueueMessage(
  threadId: string,
  chatId: number,
  text: string,
): void {
  if (!messageQueue.has(threadId)) {
    messageQueue.set(threadId, []);
  }
  messageQueue.get(threadId)!.push({ chatId, text });

  if (!activeThreads.has(threadId)) {
    processThreadQueue(threadId).catch((err) => {
      log.error({ err, threadId }, "[telegram] Error in processThreadQueue");
    });
  }
}

async function processThreadQueue(threadId: string): Promise<void> {
  if (activeThreads.has(threadId)) return;
  activeThreads.add(threadId);

  try {
    const { telegramBotToken, telegramParseMode } = loadTelegramConfig();
    const queue = messageQueue.get(threadId);

    while (queue && queue.length > 0) {
      const item = queue.shift();
      if (!item) continue;

      try {
        const reply = await runCodeagentTurn(
          item.text,
          threadId,
          undefined,
          "telegram",
        );

        if (telegramBotToken) {
          await fetch(
            `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: item.chatId,
                text: reply,
                parse_mode: telegramParseMode,
              }),
            },
          );
        }
      } catch (err) {
        log.error(
          { err, chatId: item.chatId },
          "[telegram] Error processing message",
        );
      }
    }
  } finally {
    activeThreads.delete(threadId);
  }

  // Clean up empty queue
  const remaining = messageQueue.get(threadId);
  if (!remaining || remaining.length === 0) {
    messageQueue.delete(threadId);
  }
}

/**
 * Handle a Telegram webhook update.
 *
 * Returns a result object describing the outcome, or throws on error.
 * The caller (webapp.ts) is responsible for constructing the HTTP response.
 */
export async function handleTelegramWebhook(
  update: any,
): Promise<{ ok: true; message: string }> {
  if ("message" in update) {
    const msg = update.message;
    if ("text" in msg && msg.text) {
      if (isDuplicateMessage(msg.chat.id, msg.message_id)) {
        return { ok: true, message: "Duplicate ignored" };
      }

      log.info(
        {
          chatId: msg.chat.id,
          messageId: msg.message_id,
          textLength: msg.text.length,
        },
        "[telegram] message",
      );

      const threadId = generateThreadId(msg.chat.id);
      const { telegramBotToken, telegramParseMode } = loadTelegramConfig();

      if (activeThreads.has(threadId)) {
        log.info(
          { threadId, chatId: msg.chat.id },
          "[telegram] thread busy, queuing message",
        );
        enqueueMessage(threadId, msg.chat.id, msg.text);
        await fetch(
          `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: msg.chat.id,
              text: "Message queued. I'll get to it shortly...",
              parse_mode: telegramParseMode,
            }),
          },
        );
        return { ok: true, message: "Message queued" };
      }

      await sendChatAction(telegramBotToken, msg.chat.id, "typing");
      enqueueMessage(threadId, msg.chat.id, msg.text);
      return { ok: true, message: "Message processing started" };
    }
  }

  return { ok: true, message: "Update received" };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/webhooks/telegram.ts
git commit -m "feat: extract Telegram webhook handler into src/webhooks/telegram.ts"
```

---

### Task 4: Update `src/webapp.ts` to use extracted handlers

**Files:**
- Modify: `src/webapp.ts`

This is the main integration step. We replace the inline webhook handler code with calls to the extracted modules, while keeping signature verification and route registration in webapp.ts.

- [ ] **Step 1: Add imports for the new modules**

At the top of `src/webapp.ts`, after the existing imports (around line 153), add:

```typescript
import { handleGithubWebhook } from "./webhooks/github";
import { handleTelegramWebhook } from "./webhooks/telegram";
```

- [ ] **Step 2: Remove the inline Telegram queue infrastructure**

Delete the following from `src/webapp.ts` (lines 39-139):
- The `QueueItem` interface
- The `messageQueue` and `activeThreads` declarations
- The `generateThreadId`, `isThreadActive`, `enqueueMessage`, `processThreadQueue` functions

These are now in `src/webhooks/telegram.ts`.

Also remove the `loadTelegramConfig` import on line 140 (now unused in webapp.ts, since it's used in the telegram handler). Keep the `isDuplicateMessage` and `sendChatAction` imports only if they're used elsewhere — check: `isDuplicateMessage` is only used in the Telegram webhook handler, and `sendChatAction` is only used there too. Remove both imports from webapp.ts.

- [ ] **Step 3: Replace the `/webhook/telegram` route handler**

Replace the body of `app.post("/webhook/telegram", ...)` (lines 366-442) with:

```typescript
app.post("/webhook/telegram", async (c) => {
  try {
    const body = await c.req.json();
    const update = body as any;

    log.info(
      {
        updateId: update.update_id,
        type: Object.keys(update).find((k) => k !== "update_id") ?? "unknown",
      },
      "[webapp][telegram] update received",
    );

    const result = await handleTelegramWebhook(update);
    return c.json(result);
  } catch (error) {
    log.error({ error }, "[webapp] /webhook/telegram error");
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});
```

- [ ] **Step 4: Replace the `/webhook/github` route handler**

Replace the body of `app.post("/webhook/github", ...)` (lines 450-693) with:

```typescript
app.post("/webhook/github", async (c) => {
  try {
    const signature = c.req.header("x-hub-signature-256");
    if (!signature) {
      return c.json({ error: "Missing X-Hub-Signature-256 header" }, 401);
    }

    const rawBody = await c.req.raw.clone().arrayBuffer();
    const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim() || "";
    if (!verifyGithubSignature(new Uint8Array(rawBody), signature, secret)) {
      log.warn("[webapp][github] Invalid webhook signature");
      return c.json({ error: "Invalid webhook signature" }, 401);
    }

    const payload = JSON.parse(Buffer.from(rawBody).toString("utf-8"));
    const githubEvent = c.req.header("x-github-event");

    log.info(
      {
        event: githubEvent,
        action: payload.action,
        repository: payload.repository?.full_name,
      },
      "[webapp][github] webhook received",
    );

    handleGithubWebhook(payload, githubEvent ?? "");

    if (githubEvent === "ping") {
      return c.json({ ok: true, message: "Pong!" });
    }

    return c.json({ ok: true, message: "Event received" });
  } catch (error) {
    log.error({ error }, "[webapp] /webhook/github error");
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});
```

Note: The `ping` response needs special handling here since `handleGithubWebhook` is fire-and-forget. We check for `ping` after calling the handler and return "Pong!" for that case.

- [ ] **Step 5: Clean up unused imports in webapp.ts**

After the extraction, the following imports in `src/webapp.ts` are no longer directly used by the route handlers and can be removed:
- `isDuplicateMessage` (from `"./utils/telegram"`) — moved to telegram handler
- `sendChatAction` (from `"./utils/telegram"`) — moved to telegram handler
- `loadTelegramConfig` (from `"./utils/config"`) — moved to telegram handler
- `extractPrContext`, `fetchPrCommentsSinceLastTag`, `buildPrPrompt`, `reactToGithubComment`, `getThreadIdFromBranch`, `getGithubAppInstallationToken`, `storeGithubTokenInThread`, `postGithubComment`, `getGithubToken` (from `"./utils/github"`) — moved to github handler
- `getEmailForIdentity` (from `"./utils/identity"`) — moved to github handler

Keep: `verifyGithubSignature` (still used for signature check in webapp.ts)

So the import block at lines 140-153 becomes:

```typescript
import { verifyGithubSignature } from "./utils/github";
```

Remove the `loadTelegramConfig` import and all the other unused imports entirely.

- [ ] **Step 6: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Run existing tests**

Run: `bun test src/__tests__/webapp.test.ts`
Expected: All tests pass. The existing tests exercise the routes through Hono's `app.request()`, which still works since the route registration is in webapp.ts.

- [ ] **Step 8: Commit**

```bash
git add src/webapp.ts
git commit -m "refactor: use extracted webhook handlers in webapp.ts"
```

---

### Task 5: Write tests for `src/webhooks/github.ts`

**Files:**
- Create: `src/webhooks/__tests__/github.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { spyOn } from "bun:test";
import * as server from "../../server";
import * as githubUtils from "../../utils/github";
import * as identityUtils from "../../utils/identity";

// Mock dependencies before importing the handler
mock.module("../../server", () => ({
  runCodeagentTurn: async (input: string) => `Mocked reply for: ${input}`,
}));

mock.module("../../utils/github", () => ({
  extractPrContext: async () => [
    { owner: "test", name: "repo" }, 123, "main", "testuser", "https://github.com/test/repo/pull/123", 1, "node-1",
  ],
  fetchPrCommentsSinceLastTag: async () => [{ body: "test comment" }],
  buildPrPrompt: () => "mock pr prompt",
  reactToGithubComment: async () => true,
  getThreadIdFromBranch: async () => "mock-thread-id",
  getGithubAppInstallationToken: async () => "mock-token",
  storeGithubTokenInThread: async () => {},
  postGithubComment: async () => true,
  getGithubToken: () => "mock-gh-token",
}));

mock.module("../../utils/identity", () => ({
  getEmailForIdentity: () => "test@example.com",
}));

const { handleGithubWebhook } = await import("../github");

describe("handleGithubWebhook", () => {
  it("handles ping event without errors", () => {
    expect(() => handleGithubWebhook({}, "ping")).not.toThrow();
  });

  it("handles unknown events gracefully", () => {
    expect(() => handleGithubWebhook({}, "unknown_event")).not.toThrow();
  });

  it("handles push event", async () => {
    handleGithubWebhook(
      {
        ref: "refs/heads/main",
        repository: { full_name: "test/repo" },
        commits: [{}],
      },
      "push",
    );

    // Allow async work to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    const { runCodeagentTurn } = await import("../../server");
    expect(runCodeagentTurn).toHaveBeenCalled();
  });

  it("handles pull_request event", async () => {
    handleGithubWebhook(
      {
        action: "opened",
        pull_request: { number: 1 },
        repository: { full_name: "test/repo" },
      },
      "pull_request",
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    const { runCodeagentTurn } = await import("../../server");
    expect(runCodeagentTurn).toHaveBeenCalled();
  });

  it("handles issues opened event", async () => {
    handleGithubWebhook(
      {
        action: "opened",
        issue: {
          number: 42,
          title: "Bug report",
          body: "Something is broken",
        },
        repository: {
          full_name: "test/repo",
          name: "repo",
          owner: { login: "test" },
        },
      },
      "issues",
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    const { runCodeagentTurn } = await import("../../server");
    expect(runCodeagentTurn).toHaveBeenCalled();
  });

  it("ignores issues that are not opened", () => {
    handleGithubWebhook(
      {
        action: "closed",
        issue: { number: 42, title: "Bug report" },
        repository: { full_name: "test/repo" },
      },
      "issues",
    );

    // Should not throw, and should not call runCodeagentTurn
    // (no async work expected)
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `bun test src/webhooks/__tests__/github.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/webhooks/__tests__/github.test.ts
git commit -m "test: add unit tests for extracted GitHub webhook handler"
```

---

### Task 6: Write tests for `src/webhooks/telegram.ts`

**Files:**
- Create: `src/webhooks/__tests__/telegram.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect, mock } from "bun:test";

mock.module("../../server", () => ({
  runCodeagentTurn: async (input: string) => `Mocked reply for: ${input}`,
}));

mock.module("../../utils/config", () => ({
  loadTelegramConfig: () => ({
    telegramBotToken: "mock-bot-token",
    telegramParseMode: "HTML",
  }),
}));

mock.module("../../utils/telegram", () => ({
  isDuplicateMessage: () => false,
  sendChatAction: async () => {},
}));

const { handleTelegramWebhook } = await import("../telegram");

describe("handleTelegramWebhook", () => {
  it("returns ok for non-message updates", async () => {
    const result = await handleTelegramWebhook({
      update_id: 12345,
      edited_message: { text: "edited" },
    });

    expect(result.ok).toBe(true);
    expect(result.message).toBe("Update received");
  });

  it("processes text messages", async () => {
    const result = await handleTelegramWebhook({
      update_id: 12345,
      message: {
        message_id: 1,
        chat: { id: 98765 },
        text: "hello world",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.message).toBe("Message processing started");
  });

  it("handles messages without text", async () => {
    const result = await handleTelegramWebhook({
      update_id: 12345,
      message: {
        message_id: 2,
        chat: { id: 98765 },
        photo: [{}],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.message).toBe("Update received");
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `bun test src/webhooks/__tests__/telegram.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/webhooks/__tests__/telegram.test.ts
git commit -m "test: add unit tests for extracted Telegram webhook handler"
```

---

### Task 7: Run full test suite and verify

- [ ] **Step 1: Run all tests**

Run: `bun test`
Expected: All tests pass, including the existing `src/__tests__/webapp.test.ts`

- [ ] **Step 2: Verify TypeScript compiles cleanly**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify webapp.ts line count**

Run: `wc -l src/webapp.ts`
Expected: ~700-750 lines (down from 1010)
