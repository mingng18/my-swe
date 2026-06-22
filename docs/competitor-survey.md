# Competitor Feature Survey — AI Coding Agents

> Generated **2026-06-14** by an autonomous `/loop`.
> Window: last 30 days (2026-05-15 → 2026-06-14).
> Method: `last30days` skill engine (Reddit 15, HN 21, YouTube 2, GitHub 2, Polymarket 3) + targeted WebSearch supplements for authoritative changelogs.
> Drives: [`docs/roadmap.md`](./roadmap.md).

## Market signal (last 30 days)

- **Anthropic dominates coding AI.** Polymarket "Anthropic have the best Coding AI" sits at **96%**.
- **OSS leaders my-swe already builds on.** [sst/opencode](https://github.com/sst/opencode) (174K★, 7,061 open issues) is Bullhorse's default harness; [cline/cline](https://github.com/cline/cline) (63K★) is the IDE/SDK peer. Bullhorse inherits upstream OpenCode momentum.
- **The breakout theme is guardrails, not features.** The highest-signal novel items in the window were *agent firewalls*, *runaway-cost kill-switches*, and *supply-chain attacks targeting coding agents* — not new editing capabilities.

## What competitors ship

### Claude Code (leader — 96% coding-AI market per Polymarket)
- **Plugin system**: bundle commands, subagents, hooks, and MCP servers from marketplaces.
- **Event-driven hooks**: `SessionStart`, `PreToolUse`, `PostToolUse` events; hooks can call MCP tools directly via `type: "mcp_tool"`; `agent_id`/`agent_type` fields let external automation distinguish top-level session from subagents.
- **MCP elicitation**: servers can ask the user clarifying questions mid-flow.
- **Cost tracking**: `/cost` surfaces spend including MCP tool usage.
- **Transcript search**, Plan mode.
- Source: [Claude Code what's-new (w17)](https://code.claude.com/docs/en/whats-new/2026-w17)

### Cursor
- **Plan vs Act modes**: Plan gathers info + defines a plan with the user; Act does autonomous multi-file edits with inline diffs.
- Memory features.
- Source: [Cursor forum — Plan vs Act](https://forum.cursor.com/t/plan-vs-act-modes/43550)

### Cline
- **Plan/Act split**, **MCP Marketplace**, **Rules system**, **Computer Use**, **checkpoints/time-travel** (restore any prior agent state).
- Source: [cline/cline](https://github.com/cline/cline)

### Aider
- **Architect/Editor two-model split**: a strong "architect" model reasons about the problem; a cheaper "editor" model applies edits. State-of-the-art code-editing quality at lower cost.
- **Atomic Git commits**, 50+ models, ~4.2x token efficiency vs Claude Code, checkpoints, OpenSpec.
- Sources: [Why I still use Aider in 2026](https://semyonsinchenko.github.io/ssinchenko/post/aider_2026_and_other_topics/), [Aider guide (deployhq)](https://www.deployhq.com/guides/aider)

## Trending in the last 30 days (novel signal)

1. **Agent firewalls / runaway-cost runtimes.** [Guardian Runtime](https://pypi.org/project/guardian-runtime/) is a local firewall for AI coding agents with cost control. "Agent Boundaries" was renamed **"Agent Firewall"** (Apr 2026). "agent-airlock" adds RBAC + sandboxed execution for untrusted code. The pattern: **network-egress allowlists, command allowlists, automatic budget enforcement**.
2. **Supply-chain attacks on coding agents.** The [Miasma worm](https://safedep.io/miasma-worm-ai-coding-agent-config-injection/) targets coding agents by injecting malicious instructions via GitHub repo config / `CLAUDE.md` / issue bodies. Implication: **untrusted repo content must be treated as adversarial input**, never as instructions.
3. **Gated/approval workflows.** [zero-ratchet](https://www.reddit.com/r/PromptEngineering/comments/1u58gio/zeroratchet_a_gated_workflow_for_ai_coding_agents/) (r/PromptEngineering) — a gated workflow that only "ratchets" forward through approved steps.
4. **Sandboxed agent runtimes.** NVIDIA **OpenShell** (GTC 2026) — open-source sandboxed runtime for autonomous agents.
5. **Prompt-level guardrails are insufficient.** [Parallax (arXiv)](https://arxiv.org/html/2604.12986v1) argues guardrails at the prompt layer are the wrong abstraction; enforcement belongs at the runtime/permission layer.

## Sources

- Claude Code what's-new — https://code.claude.com/docs/en/whats-new/2026-w17
- Cursor Plan vs Act — https://forum.cursor.com/t/plan-vs-act-modes/43550
- Aider 2026 — https://semyonsinchenko.github.io/ssinchenko/post/aider_2026_and_other_topics/
- Aider guide — https://www.deployhq.com/guides/aider
- sst/opencode — https://github.com/sst/opencode
- cline/cline — https://github.com/cline/cline
- Guardian Runtime — https://pypi.org/project/guardian-runtime/
- Miasma worm — https://safedep.io/miasma-worm-ai-coding-agent-config-injection/
- zero-ratchet — https://www.reddit.com/r/PromptEngineering/comments/1u58gio/zeroratchet_a_gated_workflow_for_ai_coding_agents/
- Parallax (arXiv) — https://arxiv.org/html/2604.12986v1
- Raw engine dump — `~/Documents/Last30Days/ai-coding-agents-new-features-raw-v3.md`
