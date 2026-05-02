# Review Scope

## Target

The `src/` directory - main source code for the Bullhorse agentic coder + deterministic linter pipeline (TypeScript/Node.js with LangGraph)

## Files

**Total files:** 242 files
**TypeScript files:** 227 files

**Key directories:**
- `src/harness/` - Agent harness implementations (deepagents.ts, opencode.ts, agentHarness.ts)
- `src/middleware/` - LangChain middleware (context compaction, loop detection, tool invocation limits)
- `src/nodes/` - LangGraph nodes (coder.ts, linter.ts)
- `src/tools/` - Agent tools (code search, semantic search, GitHub integration, sandbox)
- `src/utils/` - Utilities (GitHub API, cache, memory)
- `src/memory/` - Memory backends (Supabase, repo memory)
- `src/server.ts` - LangGraph server entry point
- `src/webapp.ts` - HTTP API (Hono)
- `src/stream.ts` - SSE streaming

**Modified files (from git status):**
- `src/harness/deepagents.ts`
- `src/stream.ts`
- `src/webapp.ts`

## Flags

- Security Focus: no
- Performance Critical: no
- Strict Mode: no
- Framework: auto-detected (TypeScript, LangGraph, LangChain, Hono)

## Review Phases

1. Code Quality & Architecture
2. Security & Performance
3. Testing & Documentation
4. Best Practices & Standards
5. Consolidated Report
