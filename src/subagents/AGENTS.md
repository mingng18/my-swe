# AGENTS.md for `src/subagents/`

## Package Identity

Subagent system - specialized agents for discrete tasks (explore, plan, verify, etc.).
Built on DeepAgents' subagent architecture with tool filtering and async execution.
Supports both built-in subagents and repo-specific custom agents loaded from `.agents/agents/`.

## Setup & Run

- Typecheck: `bunx tsc --noEmit`
- Enable subagents: `SUBAGENTS_ENABLED=true` (default), `ASYNC_SUBAGENTS_ENABLED=true`
- Run with subagents: `bun run start`
- Test subagent loading: `bun test src/subagents/__tests__/`

## Patterns & Conventions

- ✅ DO: Define built-in subagents in `src/subagents/registry.ts` as `SubAgent` objects with name, description, systemPrompt, and tools.
- ✅ DO: Use `filterToolsByName()` to whitelist/blacklist tools per subagent (e.g., verification agent gets test tools only).
- ✅ DO: Keep system prompts in `src/subagents/prompts/` (e.g., `explore.ts`, `plan.ts`).
- ✅ DO: Define repo-specific agents in `.agents/agents/*.md` with YAML frontmatter (name, description, tools, disallowedTools).
- ✅ DO: Merge built-in and repo agents with `mergeSubagents()`; repo agents override built-in with same name.
- ✅ DO: Use async subagents (`src/subagents/async.ts`) for long-running verification tasks.
- ❌ DON'T: Duplicate agent definitions; use the registry pattern.
- ❌ DON'T: Skip tool filtering for specialized agents (e.g., explore agent shouldn't have write tools).
- ❌ DON'T: Put LLM logic directly in subagent files; delegate to DeepAgents.

## Touch Points / Key Files

- Built-in subagent registry: `src/subagents/registry.ts`
- Repo agent loader: `src/subagents/agentsLoader.ts`
- Tool filter: `src/subagents/toolFilter.ts`
- Async subagents: `src/subagents/async.ts`
- Verification subagent graph: `src/subagents/verification/graph.ts`
- Agent prompts: `src/subagents/prompts/explore.ts`, `src/subagents/prompts/plan.ts`, `src/subagents/prompts/general.ts`

## JIT Index Hints

- Find subagent definitions: `rg -n "name:.*description:.*systemPrompt" src/subagents/registry.ts`
- Find tool filtering: `rg -n "filterToolsByName|tools:|disallowedTools:" src/subagents`
- Find repo agent loading: `rg -n "loadRepoAgents|parseAgentsMd|REPO_AGENTS_DIR" src/subagents`
- Find async subagent wiring: `rg -n "asyncSubagents|ASYNC_SUBAGENTS_ENABLED" src/subagents src/harness/deepagents.ts`

## Common Gotchas

- Repo agents are loaded from `.agents/agents/*.md` at runtime; changes require restart.
- Agent names must be unique; repo agents override built-in agents with the same name (logged as warning).
- Tool filtering uses exact string matching; tool names must match registered tool names in `src/tools/index.ts`.
- Async subagents require `ASYNC_SUBAGENTS_ENABLED=true` and run in background; results polled separately.
- Verification subagent uses its own LangGraph for multi-step test/lint/adversarial workflows.

## Pre-PR Checks

`bunx tsc --noEmit && bun test src/subagents/__tests__/ && bun run start`
