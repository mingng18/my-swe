# Backoff Jitter + Webhook Extraction

**Date:** 2026-05-23
**Status:** Approved

## Context

Three of five proposed improvements (thread cleanup, exponential backoff, lazy snapshot loading) are already implemented. This spec covers the two remaining gaps:

1. **No jitter on Telegram backoff** — multiple instances retry at the same instant
2. **Webhook handlers embedded in webapp.ts** — 1010-line file with 240-line GitHub handler that's untestable in isolation

## Change 1: Add Jitter to Telegram Backoff

**File:** `src/index.ts:269-272`

**Current behavior:** Exponential backoff with no randomization. Multiple instances behind a load balancer would all retry at exactly the same moment after a shared failure.

**Change:** Multiply the computed delay by a random factor between 0.75 and 1.25.

```typescript
// Before
const delayMs = Math.min(baseDelayMs * Math.pow(2, consecutiveErrors - 1), maxDelayMs);

// After
const baseDelay = Math.min(baseDelayMs * Math.pow(2, consecutiveErrors - 1), maxDelayMs);
const jitter = 0.75 + Math.random() * 0.5;
const delayMs = Math.floor(baseDelay * jitter);
```

**Scope:** Single edit, no new files or env vars. Jitter is always-on.

## Change 2: Extract Webhook Handlers

### New Files

```
src/webhooks/
  github.ts    ~200 lines
  telegram.ts  ~80 lines
```

### src/webhooks/github.ts

Exports `handleGithubWebhook(payload: any, event: string): Promise<void>`.

Contains the switch/case from the current `POST /webhook/github` handler (lines 477-684), including:
- `pull_request` / `pull_request_review` / `pull_request_review_comment` / `issue_comment` handler
- `issues` handler
- `push` handler
- `ping` / default handlers

Imports from existing modules: `extractPrContext`, `fetchPrCommentsSinceLastTag`, `reactToGithubComment`, `buildPrPrompt`, `getThreadIdFromBranch`, `storeGithubTokenInThread`, `getGithubToken`, `getGithubAppInstallationToken`, `postGithubComment`, `runCodeagentTurn`, `getEmailForIdentity`.

Uses its own logger: `createLogger("webhooks/github")`.

### src/webhooks/telegram.ts

Exports `handleTelegramWebhook(body: any, botToken: string, parseMode: string): Promise<Response | void>`.

Contains the message dedup, thread management, and queue logic from `POST /webhook/telegram` (lines 366-442).

Imports: `isDuplicateMessage`, `formatTelegramMarkdownV2`, `runCodeagentTurn`, plus queue/message helpers from index.ts (or inlined).

Uses its own logger: `createLogger("webhooks/telegram")`.

### src/webapp.ts After Extraction

- Imports `handleGithubWebhook` and `handleTelegramWebhook`
- Signature verification stays in webapp.ts (request-level concern, not webhook logic)
- Route handlers become thin wrappers:

```typescript
app.post("/webhook/github", async (c) => {
  // ... signature verification ...
  const payload = JSON.parse(...);
  const event = c.req.header("x-github-event");
  await handleGithubWebhook(payload, event);
  return c.json({ ok: true });
});
```

- webapp.ts shrinks from ~1010 to ~750 lines
- All other routes (health, metrics, memory, analytics, stream, dashboard) remain in webapp.ts

### Key Decisions

- **Signature verification stays in webapp.ts** — it's middleware-like, runs before any handler logic
- **Fire-and-forget preserved** — the async `void (async () => {})()` pattern moves into the extracted handler
- **No Hono context passed to handlers** — handlers receive plain objects, keeping them framework-independent and testable
- **No changes to src/index.ts polling** — polling and webhook handling are separate concerns

## Result

| Metric | Before | After |
|--------|--------|-------|
| webapp.ts | 1010 lines | ~750 lines |
| Backoff jitter | None | ±25% random |
| GitHub handler testable | No | Yes (plain function) |
| Telegram handler testable | No | Yes (plain function) |
