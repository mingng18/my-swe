# Scratchpad — my-swe / Open SWE–style agent

## Background and Motivation

The goal is to implement an internal coding agent similar to [Open SWE](https://github.com/langchain-ai/open-swe): Deep Agents harness, curated tools, `AGENTS.md` context, middleware, sandbox isolation, and Slack/Linear/GitHub triggers. This repo uses **Bun + Hono + `deepagents` (TypeScript)** rather than the upstream Python stack.

**MVP 0 (first ship):** Telegram bot **Bullhorse** — user sends e.g. `--repo recipe-rn Help me implement a favourite recipe function`; the app parses `--repo`, resolves the GitHub repo via **GitHub API**, assembles context (README, `AGENTS.md`, etc.), runs a **LangGraph** orchestrator whose agent node uses the coding agent to implement the feature, then replies on Telegram.

## Key Challenges and Analysis

- **Parity vs port:** Match architecture and behavior, not a full fork of the Python project.
- **Phasing:** Ship **MVP 0 (Bullhorse)** before cloud sandboxes and Slack/Linear webhooks.
- **Repo resolution:** `--repo owner/repo` is unambiguous; bare `recipe-rn` needs **`GITHUB_DEFAULT_OWNER`** or future per-user GitHub linking.
- **Secrets:** `TELEGRAM_BOT_TOKEN`, `GITHUB_TOKEN`, model provider keys—`.env` discipline (never commit `.env`).
- **Daytona sandbox lifecycle:** reuse an existing *stopped* (free) sandbox when available instead of always calling `daytona.create()`.
- **Repo sync in long-lived sandboxes:** keep cloned repos up to date with upstream `master` using `git fetch` and a lightweight periodic job.
- **Sandbox language selection:** Daytona sandbox `language` is a *create-time* attribute; our current flow initializes the sandbox before we clone/inspect the repo, so auto-detecting TS vs Python requires either (a) user/env override or (b) creating per-repo sandboxes after clone.

## High-Level Task Breakdown

Full bite-sized tasks with file paths and commands live in:

**[docs/superpowers/plans/2026-03-23-open-swe-style-agent.md](../docs/superpowers/plans/2026-03-23-open-swe-style-agent.md)**

Phases:

0. **MVP — Bullhorse:** Telegram, `--repo` parse, GitHub context, LangGraph → Deep Agent, reply
1. Core harness + local execution + optional `POST /invoke`
2. Sandbox abstraction + one provider + PR tool + middleware
3. Slack, Linear, GitHub webhooks (beyond Telegram)

Daytona follow-up (Phase 2 hardening):
0. Update `src/integrations/daytona.ts` to list labeled sandboxes and reuse a free/stopped one before creating a new sandbox.
1. Update `src/integrations/sandbox-service.ts` so `cloneRepo`:
   - does a best-effort `git fetch` immediately when a repo already exists
   - installs a periodic job that repeatedly fetches latest from `master` (with fallback to `main`).

Sandbox creation attributes (requested):
- Add pass-through for Daytona `create()` params: `language`, `envVars`, `labels`, `resources` (cpu/memory/disk), `autoStopInterval`, `autoArchiveInterval`, `autoDeleteInterval`, `ephemeral`, `networkBlockAll`, `networkAllowList`, `public`, `user`, `volumes`, `name`.
- Add env/config support so these can be set without code changes.
- Document the limitation: repo-language detection happens after clone; use an override for create-time language or switch to per-repo sandbox creation.

## Project Status Board

- [ ] MVP 0 — Bullhorse Telegram bot + parse + GitHub API + LangGraph + agent
- [ ] Phase 1 — Config hardening, `AGENTS.md` prompt, threading, `POST /invoke` (optional parallel)
- [ ] Phase 2 — Sandbox provider, Octokit PR tool, `open_pr_if_needed`
  - [ ] Daytona: reuse a stopped/free sandbox instead of always creating new
  - [ ] Daytona: allow richer `create()` params (labels/env/resources/network/public/user/volumes)
  - [ ] Repo syncing: periodic `git fetch` from upstream `master` inside sandbox
- [ ] Phase 3 — Slack, Linear, GitHub integrations
- [ ] Supabase repo memory persistence after each turn

## Executor Feedback or Help Requests

- Need to decide “source of truth” for sandbox `language`: environment override (simple) vs per-repo sandbox creation (more correct, more complex).
- PR-flow parity: decide whether `commit_and_open_pr` should proceed when there are unpushed commits but *no* uncommitted changes (Python does), and whether branch checkout should avoid resets when the branch already exists locally.
- Need to confirm Supabase env var names + table/column names for the proposed repo-memory schema before finalizing schema migrations.

## Lessons Learned

*(Planner/Executor: add durable insights after milestones.)*

## Notes — Slack pipeline vs this repo (2026-03-27)

The Slack/LangGraph pipeline you described (FastAPI `POST /webhooks/slack` → signature verify → `process_slack_mention` → LangGraph `runs.create` with per-thread queue injection middleware → agent tools include `slack_thread_reply` and `commit_and_open_pr`) is **not what this repo currently implements**.

What exists here today:

- **Transport triggers**
  - Telegram **polling loop** in `src/index.ts` (local dev) that calls `runCodeagentTurn(msg.text)` and sends a Telegram `sendMessage` reply.
  - Telegram **webhook endpoint** `POST /webhook/telegram` in `src/webapp.ts` that does the same.
  - GitHub webhook endpoint exists; **no Slack endpoints** exist in this repo.
- **Threading / queueing**
  - `runCodeagentTurn()` in `src/server.ts` hardcodes `threadId = "default-session"` and passes `configurable: { thread_id: threadId }`.
  - DeepAgents harness (`src/harness/deepagents.ts`) supports **per-thread** agent + sandbox + repo selection, but only if callers pass a real `threadId`.
  - There is **no “busy thread” detection or message queue injection middleware** like the Slack version.
- **PR link back to user**
  - There is a `commit_and_open_pr` tool (`src/tools/commit-and-open-pr.ts`) that returns a `pr_url`.
  - There is no Telegram/Slack “reply tool” inside the agent; instead, the **outer transport** returns the agent’s final text as the Telegram message.

## Plan — Change “Slack trigger” concept to Telegram trigger

Goal: make Telegram the primary E2E pipeline trigger that reliably results in a **Telegram reply containing the PR URL**, similar in spirit to “Slack prompt → PR link reply”.

Success criteria:
- A Telegram message like `--repo owner/name ...` runs the agent in a **stable thread** derived from chat context (so repo selection and any future memory are per-chat).
- The agent can open a PR via `commit_and_open_pr`, and the **Telegram reply includes the PR URL**.
- (Optional parity) Add a lightweight per-chat queue so concurrent updates don’t interleave.

High-level tasks:
- [ ] **Thread ID plumbing**: change `runCodeagentTurn()` to accept `{ threadId }` and pass it into `graph.invoke` as `configurable.thread_id`.
- [ ] **Telegram trigger uses thread ID**:
  - [ ] In `src/index.ts` polling, compute `threadId` from Telegram chat ID (and message thread ID if present) and call `runCodeagentTurn(text, { threadId })`.
  - [ ] In `src/webapp.ts` webhook, do the same.
- [ ] **Repo resolution parity**: ensure the `--repo` parsing + “sticky repo per thread” behavior in `src/harness/deepagents.ts` works end-to-end by virtue of (a) passing `threadId`, and (b) not overwriting the text payload such that `--repo` is lost.
- [ ] **PR URL in final reply**: adjust the system prompt (or agent output formatting) so the final assistant message always surfaces the `pr_url` returned by `commit_and_open_pr` (since Telegram replies are just the agent’s final text).
- [ ] **(Optional) message queue**: if needed, add a tiny in-memory per-`threadId` queue + “busy” guard around `runCodeagentTurn` for Telegram to mimic Slack’s busy-thread behavior.

## Plan: Match Python PR Flow Semantics
- [ ] Update `src/tools/commit-and-open-pr.ts` to match Python behavior:
  - [ ] Branch selection: use `config.metadata.branch_name` if provided; otherwise use `open-swe/<thread_id>` (Python), not a title-derived branch name.
  - [ ] Change detection: compute both `has_uncommitted_changes` and `has_unpushed_commits` (Python checks both); proceed if either exists; return “No changes detected” if neither exists.
  - [ ] Commit behavior: run `git commit` only when `has_uncommitted_changes` is true (Python), but still allow push+PR when only unpushed commits exist.
  - [ ] Branch checkout: if `branch_name` already exists, checkout without resetting/recreating it (Python).
- [ ] Align “unpushed commit” detection:
  - [ ] Ensure the tool runs `git fetch origin` before checking unpushed commits (current TS helper checks unpushed commits but doesn’t fetch first).
- [ ] Bring `open_pr_if_needed` safety net online (to match Python’s intended after-agent flow):
  - [ ] Wire `withOpenPrAfterAgent(...)` / `openPrIfNeeded(...)` into the active LangGraph node (likely wrap `coderNode`) so it runs when `commit_and_open_pr` didn’t succeed.
  - [ ] Update `src/middleware/open-pr.ts` token resolution to use the same token source as the `commit_and_open_pr` tool (thread metadata when present), not only `GITHUB_TOKEN`/`GH_TOKEN`.
- [ ] Comment-back step parity:
  - [ ] The TS codebase currently lacks `linear_comment` / `slack_thread_reply` / `github_comment` tools (despite prompt instructions). Decide whether to:
    - [ ] Implement `github_comment` (and later Slack/Linear) as actual tools; or
    - [ ] Remove/adjust prompt requirements so the agent doesn’t attempt calling non-existent tools.
- [ ] Verification:
  - [ ] Add/extend unit tests around `commit_and_open_pr` for: (1) only-unpushed-commits case, (2) no-changes case, (3) branch checkout existing/no-reset case, (4) PR creation 422 existing-PR reuse behavior.
