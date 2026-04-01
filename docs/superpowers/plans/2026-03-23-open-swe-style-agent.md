# Open SWE–Style Internal Coding Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal coding agent in this repo that mirrors [Open SWE](https://github.com/langchain-ai/open-swe)’s architecture—Deep Agents harness, curated tools, `AGENTS.md` context, middleware, and (in later phases) sandbox isolation plus Slack/Linear/GitHub triggers—using **TypeScript on Bun** with the existing `deepagents` npm package (upstream Open SWE is Python/LangGraph; we implement the same *patterns*, not a line-for-line port). **MVP 0** ships first as the **Bullhorse** Telegram bot: `--repo …` + GitHub API + **LangGraph** orchestrator + coding agent.

**Architecture:** **MVP:** Telegram receives user text; **`@langchain/langgraph`** runs nodes (parse → resolve repo via GitHub → fetch context → **`createDeepAgent`** → format reply). **Later:** A **Hono** server can receive other webhooks and map thread IDs to the same graph. Tools run against a **local clone** in MVP; **Phase 2** adds a **sandbox backend** (Modal, Daytona, …); **Phase 3** adds **Slack / Linear / GitHub** app triggers beyond Telegram.

**Tech Stack:** Bun, `grammy` (Telegram, MVP 0), Hono (optional / later webhooks), `@langchain/langgraph`, `deepagents`, `langchain` / `@langchain/core`, Octokit (GitHub); Slack Bolt, Linear GraphQL—Phase 3.

**Scope note:** This is intentionally split into **three phased milestones**, each shippable. If you prefer one subsystem at a time, treat each phase as its own execution batch.

The **first shippable MVP** is narrower and Telegram-driven—see **MVP 0: Bullhorse** below. Phases 1–3 remain the path to full Open SWE–style parity after MVP 0.

---

## MVP 0: Bullhorse (Telegram + GitHub + LangGraph)

**Product:** A Telegram bot named **Bullhorse** is the primary UI. The user does not start from Slack or a REST `POST /invoke`—they start from chat.

**Example message**

```text
--repo recipe-rn Help me implement a favourite recipe function
```

**End-to-end flow**

1. **Telegram** — Bullhorse receives the message (optionally in a topic/thread). `chat_id` (+ `message_thread_id` if present) identifies a stable conversation for follow-ups and mid-run messages later.
2. **Parse** — Extract optional `--repo <spec>` from the start of the text; everything after is the **task instruction**. Recommended grammar:
   - `--repo owner/repo` (explicit, preferred), e.g. `--repo acme/recipe-rn`
   - `--repo repo` — resolve `owner` via env **`GITHUB_DEFAULT_OWNER`** (or a per-user mapping table later).
3. **GitHub API** — Use a **`GITHUB_TOKEN`** (classic PAT or fine-grained with `Contents: Read` + `Metadata: Read` minimum) to:
   - **`repos.get`** — confirm the repo exists, read `default_branch`, description, topics.
   - **Context bundle for the agent** — e.g. README from default branch, `AGENTS.md` if present (`repos.getContent`), and optionally a **shallow clone** or file listing for code search (MVP can start with README + `AGENTS.md` + one-shot `git clone` in a temp dir for local tools).
4. **LangGraph orchestrator** — `@langchain/langgraph` defines an explicit graph (not a single opaque loop), for example:
   - `parse_message` → `resolve_repo` → `fetch_github_context` → `run_coding_agent` → `format_reply`
   - State carries: `telegram_chat_id`, `repo_full_name`, `task_text`, `github_context` (structured), `agent_result`, `error`.
   - **`run_coding_agent`** node calls into **`createDeepAgent`** (or a LangChain tool-calling agent) with the GitHub-derived context injected into the system prompt and tools (`read_file`, `execute`, etc.) operating on a **local workspace** (cloned repo path) for MVP.
5. **Reply** — Bullhorse sends a Telegram message (split long messages; Markdown or plain per Telegram limits).

**What MVP 0 explicitly does *not* require**

- Slack, Linear, or GitHub App webhooks (deferred to Phase 3).
- Remote Modal/Daytona sandboxes (optional follow-up: clone in cloud).
- Automatic draft PRs (can be Phase 2).

**New / adjusted dependencies**

- **Telegram:** `grammy` (Bun-friendly, typed).
- **GitHub:** `@octokit/rest`.
- **Orchestration:** `@langchain/langgraph` (already in `package.json`).

**Environment**

- `TELEGRAM_BOT_TOKEN` — from [@BotFather](https://t.me/BotFather).
- `GITHUB_TOKEN` — repo access for the repos Bullhorse should see.
- `GITHUB_DEFAULT_OWNER` — optional default org/user when user passes `--repo recipe-rn` without `owner/`.
- `MODEL` + provider API keys as required by `deepagents` / LangChain.

**File map additions (MVP 0)**

| Path | Responsibility |
|------|----------------|
| `src/bullhorse/parseRepo.ts` | Parse `--repo` + task body; unit-tested edge cases |
| `src/bullhorse/githubContext.ts` | Octokit: resolve repo + fetch README / `AGENTS.md` |
| `src/bullhorse/graph.ts` | LangGraph `StateGraph` wiring nodes above |
| `src/bullhorse/bot.ts` | `grammy` bot, webhook or long-polling for dev |
| `src/bullhorse/runTurn.ts` | Single entry: message in → graph invoke → outbound text |

**MVP 0 task order (high level)**

1. Config + `.env.example` including Telegram + GitHub.
2. `parseRepo` tests (`--repo owner/repo`, default owner, missing `--repo` → error or default repo policy).
3. `githubContext` integration (mock Octokit in tests; real smoke with token optional).
4. LangGraph graph with stub agent node (returns fixed string), then swap in `createDeepAgent`.
5. Telegram bot wired to `runTurn`; user can complete the example flow end-to-end.

After MVP 0, **Phase 1** in this document (harness details, `POST /invoke`, threading) becomes **optional** for non-Telegram clients but should stay aligned so the same graph is reusable from HTTP later.

---

## File map (target layout)

| Path | Responsibility |
|------|----------------|
| `src/config.ts` | Env validation (`Zod` or manual): model id, GitHub token, future Slack/Linear secrets |
| `src/agent/harness.ts` | `createDeepAgent` factory: system prompt, tools, middleware, backend |
| `src/agent/prompt.ts` | `constructSystemPrompt(repoRoot, agentsMd?: string)` |
| `src/agent/tools/` | One file per tool: `execute`, `fetchUrl`, `httpRequest`, `commitAndOpenPr`, integrations |
| `src/agent/middleware/` | `checkMessageQueue`, `openPrIfNeeded`, `toolError` wrappers |
| `src/routes/health.ts` | `GET /health` |
| `src/routes/webhooks/` | Slack, Linear, GitHub—stubs in Phase 1, real handlers in Phase 3 |
| `src/threading.ts` | Thread ID derivation + in-memory queue (swap for Redis later) |
| `src/index.ts` | Hono app composition, server export |
| `tests/` | Bun test runner: unit tests for threading, prompt, tool contracts |
| `AGENTS.md` | Repo conventions for the agent (user-maintained) |

---

## Phase 1 — Core harness + local execution (post–MVP 0 or parallel track)

Use this phase to harden the agent harness and add **`POST /invoke`** for testing without Telegram. **MVP 0 (Bullhorse)** can ship first using the same harness from `src/agent/` once extracted.

### Task 1: Configuration and project skeleton

**Files:**
- Create: `src/config.ts`
- Modify: `package.json` (add `test` script, `zod` if used)
- Create: `.env.example` (no secrets; list `MODEL`, `GITHUB_TOKEN`, `PORT`)

- [ ] **Step 1: Add env schema**

Validate at startup: `PORT` (default 3000), `MODEL` (string, required for agent), optional `GITHUB_TOKEN` for later PR tool.

- [ ] **Step 2: Wire config into `src/index.ts`**

Read config once; fail fast with clear errors on missing `MODEL`.

- [ ] **Step 3: Commit**

```bash
git add src/config.ts src/index.ts package.json .env.example
git commit -m "chore: add env config and fail-fast validation"
```

---

### Task 2: Load and inject `AGENTS.md`

**Files:**
- Create: `src/agent/prompt.ts`
- Create: `AGENTS.md` (minimal starter for this repo)
- Test: `tests/prompt.test.ts`

- [ ] **Step 1: Write failing test**

Assert `loadAgentsMd(repoRoot)` returns empty string when file missing, and content when present.

- [ ] **Step 2: Run test — expect FAIL**

`bun test tests/prompt.test.ts`

- [ ] **Step 3: Implement `loadAgentsMd` + `constructSystemPrompt`**

Concatenate base instructions + optional `AGENTS.md` section.

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

---

### Task 3: Deep agent harness (minimal tools)

**Files:**
- Create: `src/agent/harness.ts`
- Create: `src/agent/tools/execute.ts` (wrap `LocalShellBackend` / deepagents execute pattern)
- Modify: `src/agent.ts` — re-export or thin entry `runAgentTurn` for tests

**Reference:** Use `createDeepAgent` from `deepagents` per package typings; pass `model` from config.

- [ ] **Step 1: Write integration test (optional) or smoke script**

A test that invokes the agent with a trivial user message and mocks network if needed—or a `bun run src/smoke-agent.ts` that logs one reply (document expected: debug output includes step count or final text).

- [ ] **Step 2: Implement harness with filesystem tools from Deep Agents defaults**

Start with library defaults for `read_file` / `write_file` / `ls` if exposed; add one custom tool `execute` for shell.

- [ ] **Step 3: Run smoke**

`bun run src/smoke-agent.ts` or `bun test` — expect successful completion with debug logs (per user preference: program output must include debugging information).

- [ ] **Step 4: Commit**

---

### Task 4: Thread ID + in-memory message queue

**Files:**
- Create: `src/threading.ts`
- Create: `tests/threading.test.ts`
- Create: `src/agent/middleware/checkMessageQueue.ts`

- [ ] **Step 1: Define `deriveThreadId(source, channelId, rootId)`** — stable string from Slack/Linear/GitHub identifiers (specify format in code comments).

- [ ] **Step 2: Implement queue: `enqueue(threadId, message)`, `drain(threadId)`**

- [ ] **Step 3: Middleware stub** — before model call, drain queue and inject into messages (match `deepagents` middleware API).

- [ ] **Step 4: Unit tests for derive + queue**

- [ ] **Step 5: Commit**

---

### Task 5: HTTP API for manual invocation

**Files:**
- Modify: `src/index.ts`
- Create: `src/routes/invoke.ts` — `POST /invoke` with body `{ threadId, message }`

- [ ] **Step 1: Implement POST** — enqueue or pass message; run agent turn; return JSON `{ status, output }`.

- [ ] **Step 2: Manual test**

```bash
curl -s -X POST http://localhost:3000/invoke -H 'Content-Type: application/json' \
  -d '{"threadId":"test-1","message":"Say hello in one sentence."}'
```

- [ ] **Step 3: Commit**

---

## Phase 2 — Sandbox abstraction + one provider

### Task 6: `SandboxBackend` interface

**Files:**
- Create: `src/sandbox/types.ts`
- Create: `src/sandbox/local.ts` (wrap existing local behavior)
- Create: `src/sandbox/daytona.ts` or `modal.ts` (stub that throws `Not implemented` until credentials exist)

- [ ] **Step 1: Define interface** — `createSession`, `exec`, `destroy`, `uploadRepo` or clone URL.

- [ ] **Step 2: Wire harness to select backend via `SANDBOX_PROVIDER` env**

- [ ] **Step 3: Document in `.env.example`**

- [ ] **Step 4: Commit**

---

### Task 7: Implement one real provider (choose one)

Pick **Daytona** or **Modal** based on org credentials; follow their REST/SDK docs. Tasks are provider-specific—complete `src/sandbox/<provider>.ts`, add integration test behind `RUN_SANDBOX_INTEGRATION=1`.

- [ ] **Step 1: Spike** — shell `echo ok` in remote sandbox
- [ ] **Step 2: Git clone** — clone target repo into sandbox workspace
- [ ] **Step 3: Commit**

---

### Task 8: `commit_and_open_pr` tool

**Files:**
- Create: `src/agent/tools/commitAndOpenPr.ts`
- Dependency: `@octokit/rest`

- [ ] **Step 1: Install Octokit**

`bun add @octokit/rest`

- [ ] **Step 2: Tool creates branch, commits, opens **draft** PR** — parameters: `title`, `body`, branch name; uses `GITHUB_TOKEN`.

- [ ] **Step 3: Unit test with Octokit mocked**

- [ ] **Step 4: Commit**

---

### Task 9: `open_pr_if_needed` middleware

**Files:**
- Create: `src/agent/middleware/openPrIfNeeded.ts`

- [ ] **Step 1: After agent run**, if git workspace dirty and no PR opened flag, call commit tool (narrow scope—document assumptions).

- [ ] **Step 2: Commit**

---

## Phase 3 — Integrations (Slack, Linear, GitHub)

### Task 10: Slack events

**Files:**
- Create: `src/routes/webhooks/slack.ts`
- Verify signing secret; parse mentions; map to `deriveThreadId`; call invoke pipeline.

- [ ] **Step 1: Document Slack app setup** (in plan execution: add short `docs/slack-setup.md` only if you explicitly want docs)

- [ ] **Step 2: Commit**

---

### Task 11: Linear webhook

**Files:**
- Create: `src/routes/webhooks/linear.ts`

- [ ] **Step 1: Parse issue comments; detect `@openswe` equivalent** (configurable bot name)

- [ ] **Step 2: Post acknowledgement reaction / comment**

- [ ] **Step 3: Commit**

---

### Task 12: GitHub issue/PR comments

**Files:**
- Create: `src/routes/webhooks/github.ts`

- [ ] **Step 1: App webhook** — verify delivery; handle `@bot` on PRs

- [ ] **Step 2: Commit**

---

## Testing and quality bar

- **Unit:** `threading`, `prompt`, tool parameter validation (fast, no network).
- **Integration:** Sandbox provider behind env flag; Octokit with mock.
- **E2E:** Optional later—`POST /invoke` full flow in CI with mocked LLM if cost is a concern.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-03-23-open-swe-style-agent.md`.

**Two execution options:**

1. **Subagent-driven (recommended)** — One subagent per task; review between tasks; use superpowers:subagent-driven-development.

2. **Inline execution** — Batch tasks in this session with checkpoints; use superpowers:executing-plans.

**Which approach do you want?** Also confirm: **Phase 1 only first**, or do you want the full three-phase roadmap executed sequentially without stopping?

---

## Optional: plan review loop

After you approve the plan direction, run a focused review (self-review or teammate) against the checklist in the writing-plans skill: exact paths, test commands, and no ambiguous “add validation” steps. Iterate if any task lacks a verifiable outcome.
