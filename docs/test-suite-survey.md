# My-SWE Test Suite Survey

> Auto-generated survey for coding agents to verify changes against existing tests.

## Quick Reference

```bash
# Run ALL tests
bun test

# Run a specific test file
bun test src/tools/__tests__/commit-and-open-pr.test.ts

# Run tests matching a pattern
bun test --test-name-pattern "commit"

# Typecheck (always run alongside tests)
bunx tsc --noEmit
```

**Test runner:** Bun built-in (`bun:test`)  
**Total test files:** 94  
**Total tests:** 1,046  
**Assertions:** 2,142 `expect()` calls  
**Current pass rate:** 955 pass / 91 fail / 7 errors (~91% pass)

---

## Architecture Layers & Test Coverage

### 1. Harness (3 files)
Tests for the agent harness layer — DeepAgents wrapper and factory.

| File | Tests | Type | What It Tests |
|------|-------|------|---------------|
| `src/harness/__tests__/deepagents.test.ts` | unit | DeepAgentWrapper construction, tool binding, streaming |
| `src/harness/__tests__/harnessFactory.test.ts` | unit | Harness creation from config, provider selection |
| `tests/harness/deepagents.langfuse.test.ts` | unit | Langfuse callback integration with DeepAgents |

**Run:** `bun test src/harness/ tests/harness/`

---

### 2. Nodes / Deterministic (4 files + 4 duplicates in root)
Tests for the LangGraph deterministic nodes (linter, test runner, dependency installer, PR submit).

| File | Tests | Type | What It Tests |
|------|-------|------|---------------|
| `src/nodes/deterministic/__tests__/LinterNode.test.ts` | unit | Linter execution, output parsing |
| `src/nodes/deterministic/__tests__/TestRunnerNode.test.ts` | unit | Test runner execution, result handling |
| `src/nodes/deterministic/__tests__/DependencyInstallerNode.test.ts` | unit | Package manager detection, install commands |
| `src/nodes/deterministic/__tests__/PRSubmitNode.test.ts` | unit | PR creation flow, error handling |

**Note:** Duplicates exist under `src/__tests__/nodes/deterministic/` and `src/__tests__/LinterNode.test.ts` — likely legacy copies.

**Run:** `bun test src/nodes/deterministic/__tests__/`

---

### 3. Tools (17 files)
Tests for all agent-callable tools. This is the largest test group.

| File | What It Tests |
|------|---------------|
| `src/tools/__tests__/commit-and-open-pr.test.ts` | Git commit + PR creation via GitHub |
| `src/tools/__tests__/sandbox-shell.test.ts` | Shell execution in sandbox |
| `src/tools/__tests__/sandbox-files.test.ts` | File ops in sandbox (read/write/copy/move/find/grep/stat/mkdir/checksum/delete) |
| `src/tools/__tests__/code-search.test.ts` | Ripgrep-based code search + file slicing |
| `src/tools/__tests__/search.test.ts` | Web search tool |
| `src/tools/__tests__/semantic-search.test.ts` | Semantic/embedding-based search |
| `src/tools/__tests__/fetch-url.test.ts` | URL content fetching |
| `src/tools/__tests__/create-github-issue.test.ts` | GitHub issue creation |
| `src/tools/__tests__/close-github-issue.test.ts` | GitHub issue closing |
| `src/tools/__tests__/reopen-github-issue.test.ts` | GitHub issue reopening |
| `src/tools/__tests__/comment-github-issue.test.ts` | GitHub issue commenting |
| `src/tools/__tests__/github-comment.test.ts` | GitHub comment formatting |
| `src/tools/__tests__/pr-review.test.ts` | PR review tool |
| `src/tools/__tests__/merge-pr.test.ts` | PR merge tool |
| `src/tools/__tests__/artifact-update.test.ts` | Artifact/state update tool |
| `src/tools/__tests__/call-mcp-tool.test.ts` | MCP protocol tool calling |

**Run:** `bun test src/tools/__tests__/`

**Known failing:** sandbox-files (all backend-based tool tests), code-search (search mode + slice mode). These require a sandbox backend mock that may not be properly configured.

---

### 4. Integrations (3 files)
Tests for sandbox service integrations (Daytona, OpenSandbox).

| File | What It Tests |
|------|---------------|
| `src/integrations/__tests__/sandbox-service.test.ts` | Sandbox service lifecycle |
| `src/integrations/__tests__/opensandbox.test.ts` | Alibaba OpenSandbox backend |
| `src/integrations/__tests__/daytona.test.ts` | Daytona sandbox backend |

**Run:** `bun test src/integrations/__tests__/`

---

### 5. Middleware (10 files)
Tests for the middleware pipeline — context compaction, PR safety, loop detection, security headers, etc.

| File | What It Tests |
|------|---------------|
| `src/middleware/compact-middleware/index.test.ts` | Core context compaction logic |
| `src/middleware/compact-middleware/turn-detection.test.ts` | Turn boundary detection |
| `src/middleware/compact-middleware/compact-middleware.integration.test.ts` | Full compaction pipeline |
| `src/middleware/open-pr.test.ts` | Open-PR-after-agent middleware |
| `src/middleware/ensure-no-empty-msg.test.ts` | Empty message guard |
| `src/middleware/loop-detection.test.ts` | Infinite loop detection |
| `src/middleware/securityHeaders.test.ts` | HTTP security headers |
| `src/middleware/skill-compaction-protection.test.ts` | Prevent skills from being compacted |
| `src/middleware/progressive-context-edit.test.ts` | Progressive context editing |
| `src/middleware/tool-invocation-limits.integration.test.ts` | Tool call limits enforcement |

**Run:** `bun test src/middleware/`

---

### 6. Subagents (7 files)
Tests for the subagent system — registry, reviewer routing, tool filtering, verification graph.

| File | What It Tests |
|------|---------------|
| `src/subagents/__tests__/registry.test.ts` | Subagent registry (11 built-in agents) |
| `src/subagents/__tests__/agentsLoader.test.ts` | Async subagent loading |
| `src/subagents/__tests__/reviewerMapping.test.ts` | File→reviewer mapping (TS/Go/Python/Rust/Java/SQL) |
| `src/subagents/__tests__/reviewerParser.test.ts` | Review output parsing |
| `src/subagents/__tests__/toolFilter.test.ts` | Per-agent tool filtering |
| `src/subagents/__tests__/subagents.integration.test.ts` | End-to-end subagent creation |
| `src/subagents/verification/__tests__/graph.test.ts` | Verification subagent graph |

**Run:** `bun test src/subagents/`

**Known failing:** registry tests (agent count mismatch), reviewerMapping, subagents integration. Likely the agent list changed but tests weren't updated.

---

### 7. Memory (7 files)
Tests for the memory persistence layer — Supabase-backed repo memory, embeddings, consolidation.

| File | What It Tests |
|------|---------------|
| `src/memory/__tests__/repository.test.ts` | Memory repository CRUD |
| `src/memory/__tests__/search.test.ts` | Memory search |
| `src/memory/__tests__/embeddings.test.ts` | Embedding generation |
| `src/memory/__tests__/consolidation.test.ts` | Memory consolidation |
| `src/memory/__tests__/extractor.test.ts` | Fact extraction from conversations |
| `src/memory/__tests__/daemon.test.ts` | Background memory daemon |
| `src/memory/memory.integration.test.ts` | Full memory system integration |

**Run:** `bun test src/memory/`

---

### 8. Blueprints (8 files)
Tests for the blueprint/action system — declarative agent behavior specifications.

| File | What It Tests |
|------|---------------|
| `src/blueprints/blueprint.test.ts` | Core blueprint data structures |
| `src/blueprints/__tests__/types.test.ts` | Blueprint type validation |
| `src/blueprints/__tests__/loader.test.ts` | Blueprint loading from config |
| `src/blueprints/__tests__/compiler.test.ts` | Blueprint→graph compilation |
| `src/blueprints/__tests__/selection.test.ts` | Blueprint selection logic |
| `src/blueprints/__tests__/actions.test.ts` | Action execution |
| `src/blueprints/__tests__/blueprints.integration.test.ts` | Full blueprint pipeline |
| `src/blueprints/retry-loop.test.ts` | Bounded retry loop |

**Run:** `bun test src/blueprints/`

---

### 9. Skills (3 files)
Tests for the agent skills system — discovery, catalog, registry.

| File | What It Tests |
|------|---------------|
| `src/skills/__tests__/discovery.test.ts` | Skill file discovery |
| `src/skills/__tests__/catalog.test.ts` | Skill catalog management |
| `src/skills/__tests__/registry.test.ts` | Skill registry |

**Run:** `bun test src/skills/`

---

### 10. Sandbox (1 file)

| File | What It Tests |
|------|---------------|
| `src/sandbox/snapshot-scheduler.test.ts` | Snapshot create/restore/refresh lifecycle |

**Run:** `bun test src/sandbox/`

---

### 11. Utils (19 files)
Tests for shared utilities — the widest variety of unit tests.

| File | What It Tests |
|------|---------------|
| `src/utils/__tests__/config.test.ts` | Config loading from env |
| `src/utils/__tests__/sanitize.test.ts` | Input sanitization |
| `src/utils/__tests__/yaml.test.ts` | YAML parsing utilities |
| `src/utils/__tests__/retry.test.ts` | Retry logic |
| `src/utils/__tests__/backoff-config.test.ts` | Backoff configuration |
| `src/utils/__tests__/output-compressor.test.ts` | Output compression |
| `src/utils/__tests__/context-compactor.test.ts` | Context window management |
| `src/utils/__tests__/escalation-store.test.ts` | Escalation state |
| `src/utils/__tests__/memory-pointer.test.ts` | Memory pointer resolution |
| `src/utils/memory-pointer.test.ts` | Memory pointer (collocated) |
| `src/utils/__tests__/telegram.test.ts` | Telegram helpers |
| `src/utils/__tests__/thread-cleanup-scheduler.test.ts` | Thread cleanup scheduling |
| `src/utils/__tests__/multimodal.benchmark.test.ts` | Multimodal input benchmarks |
| `src/utils/cache/__tests__/lru-cache.test.ts` | LRU cache implementation |
| `src/utils/github/github.test.ts` | GitHub API utilities |
| `src/utils/github/github-cache.test.ts` | GitHub API response caching |
| `src/utils/github/authorship.test.ts` | Code authorship attribution |
| `src/utils/github/security.test.ts` | GitHub security scanning |
| `tests/utils/langfuse.test.ts` | `maskSensitiveData()` for Bearer tokens, API keys |
| `tests/utils/telegram.test.ts` | `isDuplicateMessage()`, `formatCodeBlock()`, `formatTelegramMarkdownV2()` |

**Run:** `bun test src/utils/ tests/utils/`

**Known failing:** github-cache tests (mock issues), telegram dedup (shared state between test files).

---

### 12. Webhooks (2 files)

| File | What It Tests |
|------|---------------|
| `src/webhooks/__tests__/github.test.ts` | GitHub webhook handling |
| `src/webhooks/__tests__/telegram.test.ts` | Telegram webhook handling |

**Run:** `bun test src/webhooks/`

---

### 13. Server / Graph / Root (8 files)
Tests for the top-level graph assembly, server routing, prompt building, and webapp.

| File | What It Tests |
|------|---------------|
| `src/__tests__/server.test.ts` | Graph assembly, node routing, `runCodeagentTurn` |
| `src/__tests__/webapp.test.ts` | HTTP server, SSE endpoints, webhook routes |
| `src/__tests__/prompt.test.ts` | System prompt construction |
| `src/__tests__/verification-pipeline.test.ts` | Verification pipeline orchestration |
| `src/__tests__/LinterNode.test.ts` | Legacy LinterNode test (duplicate) |
| `src/__tests__/nodes/deterministic/*.test.ts` | Legacy duplicates from `src/nodes/deterministic/__tests__/` |

**Run:** `bun test src/__tests__/`

---

### 14. SSE Stream (1 file)

| File | What It Tests |
|------|---------------|
| `tests/stream.test.ts` | SSE endpoint: connection, auth, event emission, concurrent streams, cleanup |

**Type:** Integration (starts real HTTP server)  
**Run:** `bun test tests/stream.test.ts`

---

### 15. E2E API Tests (1 file)

| File | What It Tests |
|------|---------------|
| `tests/e2e/api.e2e.test.ts` | Full HTTP stack: health, info, /run, /v1/chat/completions, SSE, GitHub webhook, auth, CORS, rate limiting |

**Type:** E2E (starts its own Bun.serve on port 9876, hits real Hono app)  
**Run:** `make test-e2e` or `bun test tests/e2e/`  
**Tests:** 24 (all passing)  
**No external deps needed** — tests the transport layer (routing, validation, auth, rate limits) without requiring an LLM provider or sandbox backend.

---

## Known Failures (91 tests)

These test failures are **pre-existing** — not caused by your changes. Grouped by root cause:

### A. Sandbox Backend Mock Not Configured (~40 tests)
All `Sandbox Files Tools` tests + `codeSearchTool` tests fail because they need a sandbox backend mock. The tests call `execute()` on tools that delegate to a sandbox which isn't wired up in the test environment.

**Files:** `src/tools/__tests__/sandbox-files.test.ts`, `src/tools/__tests__/code-search.test.ts`

### B. Subagent Registry Out of Sync (~20 tests)
The registry expects 11 built-in subagents but the actual count may differ, and reviewer mappings have drifted from the implementation.

**Files:** `src/subagents/__tests__/registry.test.ts`, `src/subagents/__tests__/reviewerMapping.test.ts`, `src/subagents/__tests__/subagents.integration.test.ts`

### C. GitHub Cache Mock Issues (5 tests)
Cache tests fail due to mock setup issues with the GitHub API client.

**File:** `src/utils/github/github-cache.test.ts`

### D. Telegram Utilities Shared State (6+ tests)
`isDuplicateMessage` uses a module-level Map. When tests in `tests/utils/telegram.test.ts` and `src/utils/__tests__/telegram.test.ts` run together, they share state and some dedup assertions fail.

**Files:** `tests/utils/telegram.test.ts`, `src/utils/__tests__/telegram.test.ts`

### E. Other (Misc)
- `github token encryption (v2)` — single test, crypto-related
- `sendChatAction` / `loadTelegramConfig` — mock fetch not set up
- `withOpenPrAfterAgent` — open-pr middleware test

---

## How to Verify Changes

### For a coding agent making changes to a specific module:

1. **Run the relevant layer tests:**
   ```bash
   # If you changed tools:
   bun test src/tools/__tests__/

   # If you changed middleware:
   bun test src/middleware/

   # If you changed a specific file:
   bun test src/tools/__tests__/commit-and-open-pr.test.ts
   ```

2. **Always typecheck:**
   ```bash
   bunx tsc --noEmit
   ```

3. **Run full suite before merge:**
   ```bash
   bun test
   ```

4. **Ignore known failures** (listed above) — only investigate NEW failures.

### Quick Verification Matrix

| Changed Module | Run This |
|---|---|
| `src/harness/` | `bun test src/harness/` |
| `src/nodes/` | `bun test src/nodes/` |
| `src/tools/` | `bun test src/tools/__tests__/` |
| `src/integrations/` | `bun test src/integrations/` |
| `src/middleware/` | `bun test src/middleware/` |
| `src/subagents/` | `bun test src/subagents/` |
| `src/memory/` | `bun test src/memory/` |
| `src/blueprints/` | `bun test src/blueprints/` |
| `src/skills/` | `bun test src/skills/` |
| `src/sandbox/` | `bun test src/sandbox/` |
| `src/utils/` | `bun test src/utils/` |
| `src/webhooks/` | `bun test src/webhooks/` |
| `src/server.ts` | `bun test src/__tests__/server.test.ts` |
| `src/webapp.ts` | `bun test tests/stream.test.ts src/__tests__/webapp.test.ts` |
| `src/index.ts` | `bun test src/__tests__/` |

---

## Test Conventions

- **Framework:** `bun:test` (`describe`, `it`, `expect`, `beforeEach`, `beforeAll`, `afterAll`)
- **File naming:** `*.test.ts` — all test files use this suffix
- **Location:** `__tests__/` subdirectory next to source, OR collocated in same directory
- **Mocking:** `mock()` from `bun:test` for module mocks; manual mocks with jest-style patterns
- **No test config file:** Bun auto-discovers `*.test.ts` files
- **Integration tests:** Named `*.integration.test.ts` — may need env vars or external services
- **Benchmark tests:** Named `*.benchmark.test.ts` — performance measurement, not pass/fail
