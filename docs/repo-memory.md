# Repo Memory (Supabase)

Bullhorse can persist repo-scoped “memories” after each agent turn, so the system can recover context and build longer-lived knowledge about the repository it is working on.

## What “repo memory” means here

On each completed `runCodeagentTurn(...)`, Bullhorse will (optionally) write:

- A durable **run record** (`agent_run`)
- A durable **thread → repo binding** (`thread_repo_context`)
- A set of **structured facts** about the turn and deterministic checkpoints (`repo_memory_facts`)
- Optionally, a **text chunk** suitable for later embedding/search (`repo_memory_chunks`)

These writes are **best-effort** and **non-fatal**: Supabase failures never break the agent reply path.

## When it writes

- **Once per turn**, after the LangGraph pipeline has finished and the final output string is assembled.
- Implementation hook is in `src/server.ts` inside `runCodeagentTurn(...)`.

## How the repo is determined

Repo memory currently keys off the user’s input containing:

- `--repo owner/name`, or
- `--repo name` (resolved using `GITHUB_DEFAULT_OWNER`)

If no `--repo` is present (or `GITHUB_DEFAULT_OWNER` is missing for bare names), repo memory is skipped.

## Enabling it

1) Apply the schema migration to your Supabase Postgres project:

- `supabase/migrations/20260327000000_repo_memory.sql`

2) Configure env vars:

- `SUPABASE_REPO_MEMORY_ENABLED=true`
- `SUPABASE_URL=...`
- `SUPABASE_SERVICE_ROLE_KEY=...`

Optional:

- `SUPABASE_REPO_MEMORY_VECTOR_CHUNKS=true`

## Data model (tables)

The migration creates these tables:

- `repo`: canonical repo identity (`owner`, `name`)
- `thread_repo_context`: last repo/workspace/profile seen for a thread
- `agent_run`: one record per unique `(thread_id, input_hash)`
- `repo_memory_facts`: structured JSON facts emitted per run
- `repo_memory_decisions`: reserved for higher-level “decisions” (not written yet)
- `github_credential_refs`: reserved for storing credential references (not used yet)
- `sandbox_lease`: reserved for sandbox lease history (not written yet)
- `repo_memory_chunks`: optional text chunks with a nullable `embedding vector(1536)`

## What we write today

The implementation lives in `src/memory/supabaseRepoMemory.ts`.

### `repo`

- Upsert by `(owner, name)` to get `repo.id`.

### `thread_repo_context`

- Upsert per `thread_id` with `repo_id`, `workspace_dir`, and `profile`.

### `agent_run`

- Insert once per turn with idempotency based on the unique constraint `(thread_id, input_hash)`.
- If a matching row already exists, we patch it to update `status/error/reply_hash/finished_at`.

### `repo_memory_facts`

Insert-only facts per run (currently five fact rows):

- `turn/summary`: hashes, lengths, iteration counts, and presence booleans
- `deterministic/linter`: success/exitCode + (truncated) output/error
- `deterministic/format`: success/filesChanged + (truncated) output
- `deterministic/validation`: pass/fail, checks map, (truncated) output
- `deterministic/tests`: pass/fail, summary, (truncated) output

### `repo_memory_chunks` (optional)

If `SUPABASE_REPO_MEMORY_VECTOR_CHUNKS=true`, we insert one row containing:

- `chunk_type='assistant_reply'`
- `content_text` = assistant reply (truncated)
- `embedding` is **not** generated yet (left NULL)

## Idempotency & safety

- `agent_run` uses `input_hash = sha256(input)` and a unique constraint on `(thread_id, input_hash)` to avoid duplicates if a turn is retried.
- Writes are designed to be **best-effort** and never throw into the main request path.
- Text fields stored inside JSON are truncated to avoid oversized payloads.

## Current limitations / TODOs

- **Embeddings are not generated** yet. `repo_memory_chunks.embedding` is NULL until you add an embedding job.
- Repo identification is based only on parsing `--repo` from the turn input; it does not currently read the active repo context from the DeepAgents harness maps.
- Several tables are created for the long-term design (`repo_memory_decisions`, `sandbox_lease`, `github_credential_refs`) but are not populated yet.

## Files

- `src/server.ts`: calls the repo-memory writer after each turn
- `src/memory/supabaseRepoMemory.ts`: Supabase REST writes + hashing + truncation
- `supabase/migrations/20260327000000_repo_memory.sql`: schema (tables + pgvector)

