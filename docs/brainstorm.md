# Brainstorm — Design Decisions for the P0 Build-Out

> Generated **2026-06-14** by an autonomous `/loop`. Self-directed (user away); applies the brainstorming skill's spirit — enumerate options, pick, justify — without interactive Q&A.
> Inputs: [`competitor-survey.md`](./competitor-survey.md), [`roadmap.md`](./roadmap.md).

## Selection principle
For parallel worktree implementation, each task must be **independently grabbable** (vertical slice) and **file-isolated** (no two agents editing the same file). The four P0 items satisfy both. We defer P1/P2.

---

## P0-1 — Agent Firewall
**Options considered**
- (a) Pure middleware intercepting tool-call args (my-swe idiom — sits next to `loop-detection`, `tool-invocation-limits`).
- (b) Wrapper around the sandbox shell executor.
- (c) Standalone network proxy / eBPF firewall (heavy, platform-specific).

**Choice: (a).** A `src/middleware/agent-firewall/` middleware that (1) checks shell/command tool args against a configurable denylist (`FIREWALL_COMMAND_DENY` regexes) + allowlist, (2) checks fetch/url tool targets against a network-egress allowlist (`FIREWALL_NETWORK_ALLOW` host globs), and (3) enforces a hard kill-switch by reusing the existing `MAX_COST_PER_THREAD` / call-count budget, aborting the turn with a typed `FirewallViolationError` on breach.
**Why:** composes with the existing middleware stack; deterministic and unit-testable; no platform deps; directly answers the Guardian Runtime / Agent Firewall trend.

## P0-2 — Untrusted-Content Defang
**Options considered**
- (a) Envelope defanging — wrap external text in an `<untrusted>…</untrusted>` block with a preamble telling the model it is data, not instructions.
- (b) Strip instruction-like patterns (lossy, brittle).
- (c) Prompt-injection classifier (non-deterministic, adds latency/cost).

**Choice: (a) + optional heuristic flag.** Deterministic, non-destructive, fully testable. Applied at the trust boundaries: GitHub issue/PR bodies, foreign `CLAUDE.md`/`AGENTS.md` loads, and `fetch-url` output.
**Why:** the Miasma worm exploit is exactly instruction injection via repo content; envelope defanging is the established defense (matches Claude Code's own untrusted-content handling) and is trivially verifiable with a red-team unit test.

## P0-3 — Event-Driven Hooks Registry
**Options considered**
- (a) New internal event bus.
- (b) Extend middleware with named events.
- (c) Claude-Code-style external config-driven hooks (`SessionStart`/`PreToolUse`/`PostToolUse` → shell or `mcp_tool`).

**Choice: (c).** A `src/hooks/` registry: events carry `{ agent_id, agent_type, tool, args, result }`; handlers are shell commands or MCP tool calls loaded from a hooks config; `PreToolUse` handlers may veto. Built **on top of** the existing middleware plumbing (composition, not replacement).
**Why:** matches the market leader's extensibility surface; veto semantics give users real control; `agent_id`/`agent_type` fields are the differentiator Claude Code just shipped.

## P0-4 — Checkpoint Rewind UX
**Options considered**
- (a) Agent tool only.
- (b) HTTP route only.
- (c) Both.

**Choice: (c).** A `checkpoint_rewind` tool the agent can call **and** `POST /rewind/:threadId/:checkpointId`, both backed by the existing LangGraph checkpointer (`aget_state_history` → restore). Thin wrapper over capability that already exists.
**Why:** my-swe already persists checkpoints but never exposes rewind; this closes the Cline/Aider checkpoint-UX gap at low risk.

---

## Parallelization map (file ownership — zero overlap)
| Task | Primary files | Shared touchpoints |
|------|---------------|--------------------|
| P0-1 Firewall | new `src/middleware/agent-firewall/*` | register in middleware list (1 line) |
| P0-2 Defang | new `src/security/defang/*` | thin call sites in github + fetch-url tools |
| P0-3 Hooks | new `src/hooks/*` | register in coder node (1 line) |
| P0-4 Rewind | new `src/tools/checkpoint-rewind.ts` + route in `webapp.ts` | tool registration list (1 line) |

Each agent's substantive work lives in a **new directory**; the only shared edits are single-line registrations, which the review/merge step will sequence to avoid conflicts.

## Out of scope (deferred)
MCP elicitation, Architect/Editor routing, Plan/Act toggle, plugin/marketplace, transcript search — all in roadmap P1/P2.
