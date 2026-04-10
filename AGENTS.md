# AGENTS.md

## Project Snapshot

Bullhorse is a single-package TypeScript/Bun codebase for an agentic coding runtime.
Core stack: Bun + TypeScript + LangGraph + DeepAgents + Hono + Telegram + GitHub integrations.
Source of truth lives in `src/` with layered architecture (transport, graph nodes, tools, integrations, utils).
This repo uses a hierarchical AGENTS.md setup: open the closest file to your edit target.

## Root Setup Commands

- Install deps: `bun install`
- Run dev server (hot reload): `bun run dev`
- Run prod entrypoint locally: `bun run start`
- Run LangGraph dev server: `bun run langgraph`
- Build deploy bundle: `bun run langgraph:build`
- Prewarm sandboxes: `bun run prewarm`
- Typecheck: `bunx tsc --noEmit`
- Run tests: `bun test`
- Docker build/run: `make docker-build && make docker-run`

## Universal Conventions

- TypeScript is strict (`tsconfig.json` has `"strict": true`); keep typings explicit at boundaries.
- Keep imports at file top; avoid inline/dynamic imports unless unavoidable.
- Prefer small, composable functions with clear responsibility per file.
- Preserve existing naming style: kebab-case filenames, descriptive exported symbols.
- Prefer wrappers in `src/utils/*` over duplicating low-level logic.
- Before PR: run `bunx tsc --noEmit` and `bun test`.
- Keep PRs focused and reversible; avoid mixing refactors with behavior changes.

## Security & Secrets

- Never commit secrets (`.env`, API keys, tokens, webhook secrets).
- Use `.env.example` as template; real values go in local `.env` only.
- Treat GitHub/Telegram payloads as untrusted input; validate before use.
- Do not log raw credentials, full webhook signatures, or private tokens.

## JIT Index (what to open, not what to paste)

### Package Structure

- Source root: `src/` → [see `src/AGENTS.md`](src/AGENTS.md)
- Agent harness: `src/harness/` → [see `src/harness/AGENTS.md`](src/harness/AGENTS.md)
- Graph nodes: `src/nodes/` → [see `src/nodes/AGENTS.md`](src/nodes/AGENTS.md)
- Model tools: `src/tools/` → [see `src/tools/AGENTS.md`](src/tools/AGENTS.md)
- Integrations/sandbox: `src/integrations/` → [see `src/integrations/AGENTS.md`](src/integrations/AGENTS.md)
- Shared utilities: `src/utils/` → [see `src/utils/AGENTS.md`](src/utils/AGENTS.md)
- GitHub utilities: `src/utils/github/` → [see `src/utils/github/AGENTS.md`](src/utils/github/AGENTS.md)
- Subagents: `src/subagents/` → [see `src/subagents/AGENTS.md`](src/subagents/AGENTS.md)
- Middleware: `src/middleware/` → [see `src/middleware/AGENTS.md`](src/middleware/AGENTS.md)
- Snapshot mgmt: `src/sandbox/` → [see `src/sandbox/AGENTS.md`](src/sandbox/AGENTS.md)
- Agent skills: `src/skills/` → [see `src/skills/AGENTS.md`](src/skills/AGENTS.md)
- Memory persistence: `src/memory/` → [see `src/memory/AGENTS.md`](src/memory/AGENTS.md)
- Architecture reference: `docs/architecture-summary.md`

### Quick Find Commands

- Find graph node exports: `rg -n "export (async )?function .*Node|export const .*Node" src/nodes`
- Find tool definitions: `rg -n "tool\\(" src/tools`
- Find route handlers: `rg -n "app\\.(get|post|put|delete)" src/webapp.ts src/index.ts`
- Find env usage: `rg -n "process\\.env\\." src`
- Find repo/sandbox wiring: `rg -n "threadId|workspaceDir|--repo|Sandbox" src/harness src/integrations`
- Find GitHub API usage: `rg -n "octokit|pulls\\.|repos\\." src/utils/github`
- Find middleware definitions: `rg -n "createMiddleware|wrapModelCall" src/middleware`
- Find subagent definitions: `rg -n "name:.*description:.*systemPrompt" src/subagents`
- Find skill definitions: `rg -n "^---$|name:|description:" .agents/skills`
- Find harness implementations: `rg -n "class.*implements AgentHarness|export class.*Wrapper" src/harness`

## Definition of Done

- Change is scoped to the correct layer (node/tool/integration/util), no cross-layer duplication.
- Typecheck passes: `bunx tsc --noEmit`.
- Tests/verification pass: `bun test` (plus targeted manual verification where relevant).
- Any new behavior is discoverable from nearest `AGENTS.md` and existing file patterns.
- No secrets/credentials added to tracked files.

## Current Learned Preferences

- Use OpenAI-compatible env trio: `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `MODEL`.
- Resolve bare `--repo <name>` through `GITHUB_DEFAULT_OWNER`.
- Eager-load DeepAgents at startup to fail fast and reduce first-turn latency.
- For Telegram long-polling debugging, use non-hot mode (`bun run start`).

## Learned User Preferences

- Prefer the agent to use provided tools (commit/push/open PR) rather than returning manual `git push` instructions when tools exist.
- When terminal vulnerability warnings appear, run `npm audit` first.
- Prefer outputs that include debugging information when things fail.

## Learned Workspace Facts

- Sandbox backends are stored thread-scoped; tools should resolve the backend via `configurable.thread_id` (not a global variable) to avoid “backend not initialized” errors.
- The `open-pr` safety net middleware exists but is not wired into the executed LangGraph graph; PR flow depends on the model calling the `commit_and_open_pr` tool unless explicitly wired.
- Shell scripting in this environment may not have `python` available on PATH; prefer `bun`/Node for small automation scripts.
