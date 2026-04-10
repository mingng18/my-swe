# AGENTS.md for `src/memory/`

## Package Identity

Memory persistence layer for agent turns and repository context.
Provides Supabase-backed storage for thread metadata, agent runs, deterministic results, and optional vector chunks.
Intentionally non-fatal: failures never break the agent pipeline.

## Setup & Run

- Typecheck: `bunx tsc --noEmit`
- Enable repo memory: `SUPABASE_REPO_MEMORY_ENABLED=true`
- Run with memory: `bun run start`

## Patterns & Conventions

- ✅ DO: Treat memory writes as best-effort; use `void` to avoid awaiting.
- ✅ DO: Use `writeRepoMemoryAfterAgentTurn()` to persist after each agent turn.
- ✅ DO: Extract repo context from input (mirrors `deepagents.ts` parsing).
- ✅ DO: Use SHA256 hashes for input/reply deduplication.
- ✅ DO: Truncate large outputs before storing (`truncateForJson()`).
- ✅ DO: Use RPC for N+1 optimization; fallback to sequential requests on 404.
- ✅ DO: Log warnings but never throw; memory is optional telemetry.
- ❌ DON'T: Block agent execution on memory write failures.
- ❌ DON'T: Store sensitive credentials or PII in memory.
- ❌ DON'T: Assume schema exists; handle missing columns gracefully.

## Touch Points / Key Files

- Repo memory writer: `src/memory/supabaseRepoMemory.ts`
- Thread metadata store: `src/utils/thread-metadata-store.ts`
- Memory write call: `src/harness/deepagents.ts` (after agent invoke)

## JIT Index Hints

- Find memory writes: `rg -n "writeRepoMemoryAfterAgentTurn|supabase" src/memory src/harness`
- Find Supabase operations: `rg -n "supabaseSelect|supabaseUpsert|supabaseRpc|supabaseInsert" src/memory`
- Find thread metadata usage: `rg -n "loadPersistedThreadRepos|persistThreadRepo" src`

## Common Gotchas

- Repo memory is disabled by default; requires `SUPABASE_REPO_MEMORY_ENABLED=true`.
- RPC function `record_agent_turn` must be deployed via migration; fallback to sequential requests if missing.
- Thread-repo binding is persisted to resume sessions; cleared on `removePersistedThreadRepo()`.
- Vector chunking is opt-in via `SUPABASE_REPO_MEMORY_VECTOR_CHUNKS=true`.
- Memory writes are non-blocking; use `void` to avoid blocking agent response.

## Pre-PR Checks

`bunx tsc --noEmit && bun run start`
