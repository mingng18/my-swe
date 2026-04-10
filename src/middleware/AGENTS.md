# AGENTS.md for `src/middleware/`

## Package Identity

Request processing middleware for the agent pipeline.
Provides message queue management, loop detection, tool invocation limits, context compaction, and skill protection.
Middleware wraps model calls via `createMiddleware()` from `langchain`.

## Setup & Run

- Typecheck: `bunx tsc --noEmit`
- Run with middleware stack: `bun run start`
- Test middleware: `bun test src/middleware/*.test.ts`

## Patterns & Conventions

- ✅ DO: Create middleware with `createMiddleware({ name, wrapModelCall })` from `langchain`.
- ✅ DO: Return `handler(request)` or `handler({ ...request, messages })` for request modification.
- ✅ DO: Keep middleware focused on single responsibility (loop detection, limits, etc.).
- ✅ DO: Use `createLogger("middleware-name")` for consistent logging.
- ✅ DO: Register middleware in `src/harness/deepagents.ts` `createAgentInstance()` function.
- ✅ DO: Inject corrective messages as `{ role: "user", content: "..." }` to guide agent behavior.
- ❌ DON'T: Call tools directly from middleware; middleware is for request/response interception.
- ❌ DON'T: Modify state outside the request (except tracking Maps/Sets for limits).
- ❌ DON'T: Block indefinitely; always return `handler()` or error quickly.

## Touch Points / Key Files

- Loop detection: `src/middleware/loop-detection.ts`
- Tool invocation limits: `src/middleware/tool-invocation-limits.ts`
- Progressive context editing: `src/middleware/progressive-context-edit.ts`
- Skill compaction protection: `src/middleware/skill-compaction-protection.ts`
- Open PR safety net: `src/middleware/open-pr.ts`
- Message queue checks: `src/middleware/check-message-queue.ts`, `src/middleware/ensure-no-empty-msg.ts`

## JIT Index Hints

- Find middleware definitions: `rg -n "createMiddleware|wrapModelCall" src/middleware`
- Find middleware registration: `rg -n "middleware:" src/harness/deepagents.ts`
- Find message injection: `rg -n "role:.*user.*content" src/middleware`
- Find limit enforcement: `rg -n "shouldBlock|trackInvocation|tracker" src/middleware`

## Common Gotchas

- Middleware execution order matters: resilience (retry/fallback) → limits (loop detection, tool limits) → custom (skills, context).
- Loop detection counts consecutive identical tool calls; not all repeated calls are loops (agent may retry legitimately).
- Tool invocation limits are per-thread; clear thread tracking on cleanup.
- Progressive context editing compacts based on message importance; skills are protected from compaction.
- The `open-pr` middleware exists but is NOT wired into the LangGraph graph by default (called manually from `deepagents.ts`).

## Pre-PR Checks

`bunx tsc --noEmit && bun test src/middleware/*.test.ts && bun run start`
