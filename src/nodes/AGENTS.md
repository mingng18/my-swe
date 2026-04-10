# AGENTS.md for `src/nodes/`

## Package Identity

LangGraph graph nodes - the atomic execution units of the agent pipeline.
Each node represents either a single agent turn (agentic LLM reasoning) or a deterministic operation (shell commands, verification).
This directory is currently sparse; most logic lives in `src/harness/deepagents.ts`.

## Setup & Run

- Typecheck: `bunx tsc --noEmit`
- Run with graph wiring: `bun run start`
- Test specific node: `bun test src/nodes/__tests__/*.test.ts`

## Patterns & Conventions

- ✅ DO: Nodes should export functions like `run*Node()` that accept state and return partial state updates.
- ✅ DO: Keep nodes focused on single responsibility; delegate to tools/integrations for complex operations.
- ✅ DO: Use `createLogger("node-name")` for consistent logging.
- ✅ DO: Return structured results (e.g., `{ passed: boolean, output: string }`) for graph routing.
- ✅ DO: Place deterministic nodes in `src/nodes/deterministic/` (e.g., `LinterNode.ts`, `TestRunnerNode.ts`).
- ❌ DON'T: Put LLM calls directly in nodes; use the `coder` node via `src/harness/deepagents.ts`.
- ❌ DON'T: Mix node logic with transport or graph assembly code.

## Touch Points / Key Files

- Deterministic node index: `src/nodes/deterministic/index.ts`
- Linter node: `src/nodes/deterministic/LinterNode.ts`
- Test runner node: `src/nodes/deterministic/TestRunnerNode.ts`
- Dependency installer node: `src/nodes/deterministic/DependencyInstallerNode.ts`
- PR submit node: `src/nodes/deterministic/PRSubmitNode.ts`
- Graph assembly: `src/server.ts` (where nodes are wired together)

## JIT Index Hints

- Find node exports: `rg -n "export (async )?function .*Node|export const .*Node" src/nodes`
- Find state updates: `rg -n "state\\.[a-zA-Z_]+.*=" src/nodes`
- Find node references in graph: `rg -n "addNode|addConditionalEdges" src/server.ts`

## Common Gotchas

- Most "nodes" are actually just middleware or tools in this codebase; the graph is minimal.
- The `coder` node is implemented as a DeepAgent in `src/harness/deepagents.ts`, not as a file here.
- Deterministic nodes run in the verification pipeline AFTER the agent turn completes.

## Pre-PR Checks

`bunx tsc --noEmit && bun test src/nodes/__tests__/`
