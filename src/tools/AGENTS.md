# AGENTS.md for `src/tools/`

## Package Identity

LLM-callable tool definitions and registration used by DeepAgents.
This directory defines callable capabilities and their validation schemas.

## Setup & Run

- Typecheck: `bunx tsc --noEmit`
- Run with tool-enabled runtime: `bun run start`
- Verify tool registration: `rg -n "allTools|sandboxAllTools" src/tools src/harness/deepagents.ts`

## Patterns & Conventions

- ✅ DO: Define tools with `tool(...)` + Zod schema (pattern: `src/tools/commit-and-open-pr.ts`).
- ✅ DO: Return structured JSON strings (`success`, `error`, payload fields) for predictable agent parsing.
- ✅ DO: Read thread/repo context from `config.configurable` where needed.
- ✅ DO: Keep side-effect operations behind utility wrappers in `src/utils/github/*` or integrations.
- ✅ DO: Register every new tool in `src/tools/index.ts`.
- ❌ DON'T: Perform raw network/git side effects directly in many tool files; centralize in utilities.
- ❌ DON'T: Skip schema fields for required context; agent behavior becomes unstable.

## Touch Points / Key Files

- Tool registry: `src/tools/index.ts`
- PR automation tool: `src/tools/commit-and-open-pr.ts`
- Search tool: `src/tools/search.ts`
- URL fetch tool: `src/tools/fetch-url.ts`
- Sandbox shell/file tools: `src/tools/sandbox-shell.ts`, `src/tools/sandbox-files.ts`

## JIT Index Hints

- Find tool declarations: `rg -n "export const .*Tool = tool\\(" src/tools`
- Find schema definitions: `rg -n "schema:\\s*z\\.object" src/tools`
- Find configurable usage: `rg -n "configurable|thread_id|workspaceDir" src/tools`
- Find tool registry misses: `rg -n "allTools|sandboxAllTools" src/tools/index.ts src/tools`

## Common Gotchas

- Missing `thread_id` in tool context will break repo/sandbox-linked tools.
- Sandbox-specific tools require backend initialization and repo workspace binding.
- Keep tool descriptions concise but explicit; they shape LLM invocation behavior.

## Pre-PR Checks

`bunx tsc --noEmit && bun run start`
