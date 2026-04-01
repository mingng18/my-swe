# AGENTS.md for `src/nodes/`

## Package Identity

LangGraph node implementations: agentic (`planner`, `coder`, `fixer`) and deterministic (`format`, `linter`, `validate`, `tests`).
These files define step behavior; `src/server.ts` defines orchestration.

## Setup & Run

- Typecheck nodes: `bunx tsc --noEmit`
- Run app pipeline locally: `bun run start`
- Optional extended mode: `EXTENDED_MODE=true bun run start`
- Fast local graph checks: `bun run langgraph`

## Patterns & Conventions

- ✅ DO: Keep node input/output compatible with `CodeagentState` (`src/utils/state.ts`).
- ✅ DO: Return structured result fields (e.g., `linterResults`, `testResults`, `validationResults`) rather than free-form strings only.
- ✅ DO: Use deterministic nodes for auditable checks (pattern in `src/nodes/linter.ts`).
- ✅ DO: Wrap agentic core with middleware where needed (pattern in `src/nodes/coder.ts`).
- ✅ DO: Log concise, stage-specific metadata via `createLogger(...)`.
- ❌ DON'T: Encode routing decisions inside nodes; routing belongs in `src/server.ts`.
- ❌ DON'T: Add side effects in nodes that cannot be retried safely.

## Touch Points / Key Files

- Agentic node baseline: `src/nodes/coder.ts`
- Deterministic lint/check node: `src/nodes/linter.ts`
- Extended-mode nodes: `src/nodes/planner.ts`, `src/nodes/fixer.ts`
- Verification nodes: `src/nodes/format.ts`, `src/nodes/validate.ts`, `src/nodes/tests.ts`
- Graph routing logic: `src/server.ts`

## JIT Index Hints

- Find node exports: `rg -n "export (async )?function .*Node|export const .*Node" src/nodes`
- Find state mutations: `rg -n "return \\{" src/nodes`
- Find deterministic command execution: `rg -n "execAsync|execute\\(" src/nodes`
- Find error/retry contracts: `rg -n "error|success|passed|exitCode" src/nodes`

## Common Gotchas

- Node return keys must match what routing functions inspect in `src/server.ts`.
- `state.error` short-circuits deterministic behavior in some nodes.
- Keep outputs bounded; large payloads may be truncated in final response assembly.

## Pre-PR Checks

`bunx tsc --noEmit && bun run start`
