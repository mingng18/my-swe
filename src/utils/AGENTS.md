# AGENTS.md for `src/utils/`

## Package Identity

Shared runtime utilities: config loading, state schema/types, logging, identity mapping, thread metadata, and helper modules.
This directory is the stability boundary for cross-layer reuse.

## Setup & Run

- Typecheck: `bunx tsc --noEmit`
- Run with config validation: `bun run start`
- Quick config checks: `rg -n "load.*Config|validateStartupConfig" src/utils`

## Patterns & Conventions

- ✅ DO: Keep env parsing/validation in `src/utils/config.ts`.
- ✅ DO: Keep shared graph state definitions centralized in `src/utils/state.ts`.
- ✅ DO: Use logger factories (`src/utils/logger.ts`) for consistent logging shape.
- ✅ DO: Keep utility functions pure where possible; isolate side effects clearly.
- ✅ DO: Export focused helpers; avoid giant catch-all modules.
- ❌ DON'T: Parse env vars repeatedly in call sites when a loader already exists.
- ❌ DON'T: Put domain-specific business logic into generic util modules.

## Touch Points / Key Files

- Environment config loaders: `src/utils/config.ts`
- Graph state contract: `src/utils/state.ts`
- Logger helper: `src/utils/logger.ts`
- Thread metadata persistence: `src/utils/thread-metadata-store.ts`
- Identity mapping: `src/utils/identity.ts`
- Sandbox backend map: `src/utils/sandboxState.ts`

## JIT Index Hints

- Find config keys: `rg -n "process\\.env\\.|OPENAI_|TELEGRAM_|GITHUB_|SANDBOX_" src/utils`
- Find state definitions: `rg -n "CodeagentState|type .*State" src/utils/state.ts src/nodes src/server.ts`
- Find logger usage: `rg -n "createLogger\\(" src`

## Common Gotchas

- Keep config errors actionable; startup failures should explain missing envs.
- `thread_id`/repo metadata drift can break continuity across turns.
- Avoid circular imports between utils and higher-level layers.

## Pre-PR Checks

`bunx tsc --noEmit && bun run start`
