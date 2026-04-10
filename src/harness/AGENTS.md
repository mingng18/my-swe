# AGENTS.md for `src/harness/`

## Package Identity

Agent harness implementation - the abstraction layer between LangGraph and pluggable agent backends.
Provides `AgentHarness` interface and concrete implementations (DeepAgents, with hooks for OpenCode).
Manages agent lifecycle, tool registration, middleware stack, and thread-scoped state.

## Setup & Run

- Typecheck: `bunx tsc --noEmit`
- Run with harness: `bun run start`
- Test harness selection: `bun test src/harness/__tests__/*.test.ts`

## Patterns & Conventions

- ✅ DO: Use `AgentHarness` interface (`src/harness/agentHarness.ts`) for all agent interactions.
- ✅ DO: Register tools in `src/tools/index.ts` and pass via `tools` array to `createDeepAgent()`.
- ✅ DO: Use `createMiddleware()` from `langchain` for all agent middleware (see existing middleware in `src/harness/deepagents.ts`).
- ✅ DO: Keep thread-scoped state (agents, sandboxes, repos) in module-level Maps keyed by `thread_id`.
- ✅ DO: Initialize sandboxes lazily on first agent invoke with `--repo` flag.
- ✅ DO: Release sandboxes back to pool in `cleanupDeepAgents()` on shutdown.
- ❌ DON'T: Create multiple agent instances per thread; reuse `threadAgentMap`.
- ❌ DON'T: Access sandbox backend from tools without checking `configurable.thread_id`.
- ❌ DON'T: Add middleware directly to tools; middleware belongs in the agent constructor.

## Touch Points / Key Files

- Harness interface: `src/harness/agentHarness.ts`
- Provider factory: `src/harness/index.ts` (selects backend via `AGENT_PROVIDER`)
- DeepAgents implementation: `src/harness/deepagents.ts`
- Agent lifecycle: `createAgentInstance()`, `prepareAgent()`, `cleanupDeepAgents()`
- Tool registry: `src/tools/index.ts`

## JIT Index Hints

- Find harness implementations: `rg -n "class.*implements AgentHarness|export class.*Harness" src/harness`
- Find middleware registration: `rg -n "middleware.*=|createMiddleware" src/harness/deepagents.ts`
- Find thread state maps: `rg -n "thread(Map|Agent|Sandbox)Map" src/harness/deepagents.ts`
- Find provider selection: `rg -n "AGENT_PROVIDER|opencode|deepagents" src/harness/index.ts`

## Common Gotchas

- Sandbox backends are thread-scoped; always resolve via `configurable.thread_id` from tool context.
- The `open-pr` safety net middleware exists but is NOT wired into the LangGraph graph by default.
- Repo binding persists per-thread via `threadRepoMap`; user doesn't need to re-specify `--repo`.
- `thread_id` continuity matters for repo binding, state persistence, and sandbox backend association.
- Eager-loading DeepAgents at startup (`initDeepAgentsAtStartup()`) reduces first-turn latency but requires env validation.

## Pre-PR Checks

`bunx tsc --noEmit && bun test src/harness/__tests__/ && bun run start`
