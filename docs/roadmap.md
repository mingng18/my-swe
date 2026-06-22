# Bullhorse (my-swe) Competitive Roadmap

> Generated **2026-06-14** from [`docs/competitor-survey.md`](./competitor-survey.md).
> Owner: autonomous `/loop`. Implementation gate: `bun test` (keep the 955 passing green) + `bunx tsc --noEmit`.

## Baseline — what my-swe already has

Pluggable harness (OpenCode default / DeepAgents fallback), LangGraph coder→linter pipeline, Hono + Telegram (grammy) + LangGraph Cloud transports, Daytona + OpenSandbox backends, MCP support (`src/mcp/`), blueprints (Stripe-Minions-style state machines), skills system, 11 subagents, Supabase memory + memory-pointer pattern, context compaction middleware, semantic search, **token/cost budgeting** (`MAX_COST_PER_THREAD`), LRU cache, loop detection, security headers, tool-invocation limits, eval harness, sandbox snapshot scheduler, LangGraph checkpointer.

## Gap analysis

| # | Gap | Competitor evidence | my-swe today | Impact | Effort |
|---|-----|---------------------|--------------|--------|--------|
| 1 | **Agent firewall**: command + network-egress allowlist with automatic cost/call kill-switch | Guardian Runtime, Agent Firewall, agent-airlock, OpenShell | Has cost budgeting + sanitize, **no egress/command allowlist, no runaway kill-switch** | High (top-30d theme) | Med |
| 2 | **Untrusted-content defanging** for repo/issue/web inputs (anti-Miasma) | Miasma worm; Parallax | Reads GitHub repo content as instructions; **no defanging of external CLAUDE.md / issue bodies / READMEs** | High (active exploit theme) | Med |
| 3 | **Event-driven hooks registry** (`SessionStart`, `PreToolUse`, `PostToolUse`) with `agent_id`/`agent_type` context | Claude Code hooks | Has middleware pipeline, **no generalized user-configurable hook events** | High | Med |
| 4 | **MCP elicitation** (server-initiated user questions) | Claude Code (Mar 2026) | MCP tool calling only, **no elicitation flow** | Med | Med |
| 5 | **Architect/Editor model routing** (strong planner + cheap editor) | Aider | Single-model harness, **no two-model split** | Med (cost) | Med |
| 6 | **Checkpoint rewind UX** (restore prior agent state on demand) | Cline, Aider | Has LangGraph checkpointer + sandbox snapshots, **no user-facing rewind endpoint/tool** | Med | Low-Med |
| 7 | **Explicit Plan/Act mode toggle** | Cursor, Cline | Has plan-agent + blueprints, **no clean two-mode coder toggle** | Med | Low |
| 8 | Plugin/marketplace packaging | Claude Code | Skills are file-based, **no packaged plugin distribution** | Low | High |
| 9 | Transcript search | Claude Code | **Absent** | Low | Low |

## P0 — trending + tractable (recommended for this autonomous build-out)

These four have **minimal file overlap**, making them safe to implement in parallel worktrees. Each is independently testable.

### P0-1 — Agent Firewall (`src/middleware/agent-firewall/`)
Configurable **command allowlist/denylist** + **network-egress allowlist** + a hard **per-thread call/cost kill-switch** that aborts the turn when breached. New middleware + a `firewall.config` loader + unit tests. *Files: new `src/middleware/agent-firewall/*`; touches only the middleware registration list.*

**Acceptance**: a denied shell command is blocked and logged; a breach of the cost ceiling raises a typed error mid-turn; `bun test src/middleware/agent-firewall/` green; `tsc` clean.

### P0-2 — Untrusted-Content Defang (`src/security/defang/`)
A sanitizer that wraps externally-sourced text (GitHub issue/PR bodies, foreign `CLAUDE.md`/`AGENTS.md`, fetched URLs) in a defanged envelope so injected instructions cannot be executed as agent directives. Integrates at the GitHub-tool + fetch-url boundaries. *Files: new `src/security/defang/*`; thin integration in `src/tools/*github*` + `fetch-url`.*

**Acceptance**: an injected "ignore previous instructions" payload inside an issue body is rendered as inert quoted data; existing github/fetch tests still pass; new defang tests green; `tsc` clean.

### P0-3 — Event-Driven Hooks Registry (`src/hooks/`)
A registry firing `SessionStart`, `PreToolUse`, `PostToolUse` events to user-configured handlers (shell or `mcp_tool`), each carrying `agent_id`/`agent_type`. Reuses existing middleware as one built-in subscriber. *Files: new `src/hooks/*`; registers into the coder node without rewriting it.*

**Acceptance**: a registered `PreToolUse` handler runs and can veto a tool call; `SessionStart` fires once per thread; `bun test src/hooks/` green; `tsc` clean.

### P0-4 — Checkpoint Rewind UX (`src/tools/checkpoint-rewind.ts` + `/rewind` route)
Expose the existing LangGraph checkpointer as (a) a `checkpoint_rewind` tool the agent can call and (b) an HTTP `POST /rewind/:threadId/:checkpointId` route. *Files: new tool + route; touches `src/tools/index.ts` registration + `src/webapp.ts` router only.*

**Acceptance**: rewind restores a prior thread state; invalid checkpoint id returns 404; `bun test` for the tool + route green; `tsc` clean.

## P1 — next wave (if time permits)
- **MCP elicitation** (P0-5) — `src/mcp/` elicitation flow.
- **Architect/Editor routing** (P0-6) — harness model split.
- **Plan/Act toggle** (P0-7) — `src/nodes/coder.ts` mode flag.

## P2 — defer
Plugin/marketplace (8); transcript search (9).

## Execution model for this build-out
- Each P0 item → one GitHub issue → one isolated git worktree off `main`.
- Parallel agent team implements; a review agent gates each.
- Merge to `main` only when `bun test` (no new failures) + `bunx tsc --noEmit` are green and review passes.
