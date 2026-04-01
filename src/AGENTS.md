# AGENTS.md for `src/`

## Package Identity

`src/` contains the runtime application: transport entrypoints, graph orchestration, harness, tools, integrations, and shared utilities.
Primary framework layer is LangGraph + DeepAgents on Bun/TypeScript.

## Setup & Run

- Dev: `bun run dev`
- Start: `bun run start`
- LangGraph dev: `bun run langgraph`
- Typecheck: `bunx tsc --noEmit`
- Tests: `bun test`
- Prewarm sandbox pool: `bun run prewarm`

## Patterns & Conventions

- ✅ DO: Keep architecture layered: transport (`src/index.ts`, `src/webapp.ts`) -> graph (`src/server.ts`) -> node/tool/integration layers.
- ✅ DO: Add shared state fields in `src/utils/state.ts` before consuming across multiple nodes.
- ✅ DO: Route deterministic outcomes through structured fields (see `src/server.ts` route functions).
- ✅ DO: Keep reusable configuration in `src/utils/config.ts`.
- ✅ DO: Register model-callable tools in `src/tools/index.ts`.
- ❌ DON'T: Bypass central config helpers for new env wiring; avoid adding more direct `process.env.*` usage like in `src/server.ts`/`src/webapp.ts`.
- ❌ DON'T: Put business logic in transport handlers; delegate into graph/harness/services.

## Touch Points / Key Files

- Graph assembly and routing: `src/server.ts`
- Process entrypoint + polling mode: `src/index.ts`
- HTTP/webhook transport: `src/webapp.ts`
- Agent implementation: `src/harness/deepagents.ts`
- Shared state contract: `src/utils/state.ts`
- Runtime config loaders: `src/utils/config.ts`

## JIT Index Hints

- Find node references in graph: `rg -n "addNode|addConditionalEdges|routeAfter" src/server.ts`
- Find state field usage: `rg -n "state\\.[a-zA-Z_]+" src/nodes src/server.ts`
- Find middleware wrappers: `rg -n "with[A-Z]" src/nodes src/middleware`
- Find env-dependent behavior: `rg -n "process\\.env\\.|load.*Config" src`

## Common Gotchas

- `EXTENDED_MODE=true` changes graph shape and expected outputs.
- Sandbox mode (`USE_SANDBOX=true`) changes tool set and execution backend.
- `thread_id` continuity matters for repo binding and state persistence.

## Pre-PR Checks

`bunx tsc --noEmit && bun test && bun run start`
