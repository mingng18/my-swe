# Bullhorse Agent Performance & Reliability Enhancement Plan

**Date:** 2026-04-05
**Status:** Draft - Ready for Implementation
**Reference:** Based on `agent-trace-performance-analysis.md`

---

## Executive Summary

This plan addresses critical performance bottlenecks and reliability issues identified through comprehensive analysis of the Bullhorse autonomous agent codebase. The current implementation lacks essential safeguards against common agent failure modes including infinite loops, token snowball effects, and context overflow.

**Key Issues Identified:**
- No tool invocation limits or debouncing mechanisms
- Aggressive binary context cleanup (100k tokens → 5 messages) loses critical context
- No semantic search; only regex-based file discovery
- Minimal observability (no token tracking, no structured metrics)
- Tool errors lack actionable directives for recovery
- No Memory Pointer Pattern for large file handling

**Expected Impact:**
- **70-90% reduction** in token consumption during file discovery phase
- **Elimination** of infinite retry loops through per-tool invocation limits
- **Actionable error recovery** reducing failed task retries by 50%+
- **Real-time visibility** into cost/latency via OpenTelemetry instrumentation

---

## Phase 0: Documentation Discovery ✅ COMPLETED

### Sources Analyzed

| Component | File(s) | Key Findings |
|-----------|---------|--------------|
| Tool System | `src/tools/index.ts`, `src/tools/*.ts` | 5 core tools, no invocation limits, no debouncing |
| State Management | `src/utils/state.ts`, `src/harness/deepagents.ts` | Binary cleanup at 100k tokens, keeps only 5 messages |
| File Discovery | `src/tools/code-search.ts` | Only ripgrep regex search, no semantic capabilities |
| Observability | `src/harness/deepagents.ts:757-758` | Basic timing only, no token/metrics tracking |
| Error Handling | All tool files | JSON string errors, no retry logic, minimal directives |

### Current Architecture Gaps

**From analysis of current codebase:**

1. **Tool Invocation** (`src/tools/index.ts`):
   - No rate limiting or debouncing
   - No per-tool invocation counters
   - No circuit breaker pattern for failing tools

2. **Context Management** (`src/harness/deepagents.ts:93-100`):
   ```typescript
   new ClearToolUsesEdit({
     trigger: { tokens: 100000 },  // Too high threshold
     keep: { messages: 5 },         // Too aggressive
   })
   ```

3. **File Discovery** (`src/tools/code-search.ts`):
   - Only `rg` (ripgrep) regex search
   - No semantic or structural search
   - No intelligent file prioritization

4. **Observability**:
   - No OpenTelemetry integration
   - No token usage tracking
   - No structured metrics export

---

## Phase 1: Tool Schema Optimization

**Goal:** Prevent infinite loops and improve error recovery through defensive tool design.

**Duration:** 2-3 days
**Risk:** Low - isolated to tool layer

### 1.1 Add Per-Tool Invocation Limits

**What to implement:**
- Add invocation counter middleware to track tool usage per thread
- Implement per-tool limits with configurable thresholds
- Add debouncing for identical tool calls within time window

**Documentation references:**
- Pattern: "The Retrying Loop" resolution from analysis doc
- File to create: `src/middleware/tool-invocation-limits.ts`

**Implementation tasks:**
```
1. Create src/middleware/tool-invocation-limits.ts
   - Define interface: ToolInvocationTracker
   - Implement: trackToolCall(threadId, toolName, args)
   - Implement: shouldBlockToolCall(threadId, toolName, args)
   - Add debounce window: 5 seconds for identical calls

2. Integrate into src/harness/deepagents.ts
   - Add tracker to middleware pipeline
   - Return actionable error when limit hit:
     "Tool {tool} called {count} times. Current approach is not working.
      Try: (1) Reading error messages carefully, (2) Using alternative tool,
      (3) Escalating to human operator"

3. Add configuration via environment variables
   - TOOL_MAX_INVOCATIONS_DEFAULT: 10
   - TOOL_DEBOUNCE_WINDOW_MS: 5000
   - PER_TOOL_LIMITS_JSON: {} for custom limits
```

**Verification checklist:**
- [ ] Unit tests for invocation counting logic
- [ ] Integration test with loop detection middleware
- [ ] Manual test: agent stops after hitting tool limit
- [ ] Log verification: blocked calls are logged

**Anti-pattern guards:**
- DO NOT add global limits only (must be per-tool)
- DO NOT silently drop calls (must return actionable error)
- DO NOT use hardcoded limits (must be configurable)

### 1.2 Implement Actionable Error Responses

**What to implement:**
- Replace JSON string errors with thrown ToolErrors
- Add recovery suggestions to all error messages
- Implement retry logic with exponential backoff for network tools

**Documentation references:**
- Pattern: "Tool outputs must be engineered as communication channels"
- Files to modify: All files in `src/tools/`

**Error message format:**
```
ToolError: Failed to [action]

[Specific technical details]

NEXT STEPS:
1. [Specific recovery action]
2. [Alternative approach]
3. [Escalation path if applicable]

Context: [threadId, toolName, args summary]
```

**Implementation tasks:**
```
1. Create src/utils/tool-error.ts
   - Define ToolError class extending Error
   - Add fields: recovery, context, retryable
   - Implement formatting with recovery steps

2. Update all tools to throw ToolError:
   - fetch-url.ts: Add retry with exponential backoff
   - commit-and-open-pr.ts: Add specific git recovery steps
   - sandbox-shell.ts: Add command diagnostic suggestions
   - code-search.ts: Add pattern refinement suggestions

3. Add retry middleware:
   - Retry retryable errors up to 3 times
   - Exponential backoff: 1s, 2s, 4s
   - Log all retry attempts
```

**Verification checklist:**
- [ ] All tools use ToolError instead of JSON strings
- [ ] Error messages include specific recovery steps
- [ ] Retry logic tested with network failures
- [ ] Error logs show structured data for analysis

**Anti-pattern guards:**
- DO NOT return generic "error occurred" messages
- DO NOT silently retry without logging
- DO NOT suggest impossible recovery steps

### 1.3 Add Response Size Limits

**What to implement:**
- Add hard limits to all tool responses
- Implement pagination for list/search results
- Add truncation with metadata

**Documentation references:**
- Pattern: "Implementing mandatory pagination, range selection, and hard truncation limits"

**Implementation tasks:**
```
1. Add response size utilities:
   - src/utils/response-limit.ts
   - truncateResponse(content, maxChars, strategy)
   - Strategies: "smart", "head", "tail", "middle"

2. Update tools with size limits:
   - fetch-url.ts: Max 50k chars, smart truncate
   - search.ts: Max 10 results
   - sandbox-shell.ts: Max 10k lines stdout

3. Add pagination where applicable:
   - code-search.ts: Add page/token for continuation
   - sandbox-find.ts: Add --max-results flag
```

**Verification checklist:**
- [ ] All tools have documented size limits
- [ ] Truncated responses include metadata (truncated: true, originalSize: N)
- [ ] Large inputs handled without OOM

**Anti-pattern guards:**
- DO NOT silently truncate without indication
- DO NOT use fixed limits (must be configurable)
- DO NOT truncate error messages

---

## Phase 2: Context Engineering & Memory Pointer Pattern

**Goal:** Prevent token snowball effect and handle large artifacts efficiently.

**Duration:** 3-4 days
**Risk:** Medium - affects core execution flow

### 2.1 Implement Memory Pointer Pattern

**What to implement:**
- Large file/artifact storage on disk
- Reference ID system for stored data
- Query tools for accessing stored data

**Documentation references:**
- Pattern: "Memory Pointer Pattern" from analysis doc
- Creates 20M token → 1.2K token reduction for data-heavy workflows

**Implementation tasks:**
```
1. Create src/utils/memory-pointer.ts:
   - storeArtifact(threadId, data, metadata): returns pointerId
   - retrieveArtifact(pointerId): returns data
   - listArtifacts(threadId): returns metadata[]
   - cleanupArtifacts(threadId): removes old artifacts
   - Artifact TTL: 24 hours

2. Update tools to use Memory Pointer:
   - code-search.ts: Store results > 5k tokens
   - fetch-url.ts: Store responses > 10k tokens
   - sandbox-shell.ts: Store outputs > 5k lines

3. Add query tools:
   - artifact-query: Line range extraction
   - artifact-grep: Pattern search within artifact
   - artifact-summary: AI summary of artifact
```

**API Design:**
```typescript
// Store large data
const pointerId = await storeArtifact(threadId, {
  type: "code-search-results",
  content: largeResults,
  metadata: { query, timestamp, matchCount }
});

// Returns: "ptr_abc123"

// Query specific lines
const lines = await queryArtifact(pointerId, {
  type: "line-range",
  start: 100,
  end: 150
});
```

**Verification checklist:**
- [ ] Artifacts stored on disk (not in context)
- [ ] Pointer IDs are short and deterministic
- [ ] Query tools work without loading full artifact
- [ ] Cleanup removes old artifacts

**Anti-pattern guards:**
- DO NOT store small files (< 1k tokens) as pointers
- DO NOT include full content in pointer metadata
- DO NOT allow cross-thread artifact access (security)

### 2.2 Implement Progressive Context Compaction

**What to implement:**
- Replace binary cleanup with sliding window
- Implement message importance scoring
- Add context summary for old messages

**Documentation references:**
- Current issue: Binary 100k → 5 messages loses critical context
- Pattern: "Compaction involves summarizing the conversation history"

**Implementation tasks:**
```
1. Create src/utils/context-compactor.ts:
   - compactMessages(messages, targetSize): Message[]
   - Message scoring: importance(message): number
   - Summary generation for old messages

2. Scoring rubric:
   - User messages: +10 (never delete)
   - Final responses: +8
   - Successful tool results: +3
   - Failed tool results: +1
   - System messages: +5
   - Old messages: decay factor

3. Replace in src/harness/deepagents.ts:
   - Remove: new ClearToolUsesEdit({ trigger: { tokens: 100000 }, ... })
   - Add: Progressive compaction at 50k tokens
   - Keep: last 30 messages + top 20 by importance
```

**Verification checklist:**
- [ ] Context stays under target size
- [ ] User messages never deleted
- [ ] Old context summarized not just dropped
- [ ] No duplicate messages after compaction

**Anti-pattern guards:**
- DO NOT use token count alone (use semantic importance)
- DO NOT summarize user instructions (preserve exactly)
- DO NOT compact too frequently (> 5k token intervals)

### 2.3 Add Smart Prompt Compaction

**What to implement:**
- Dynamic prompt adjustment based on context size
- Cache static portions of system prompt
- Examples: Remove examples when context is large

**Documentation references:**
- Pattern: "Dynamic prompt shortening when approaching limits"

**Implementation tasks:**
```
1. Create src/utils/prompt-manager.ts:
   - getSystemPrompt(contextSize): string
   - Tiers: Full (< 30k), Standard (< 60k), Minimal (< 90k)

2. Prompt tiers:
   - Full: All examples, detailed instructions
   - Standard: Core instructions, 1-2 key examples
   - Minimal: Bare instructions, no examples

3. Cache static prompt portions:
   - Use content-hash-cache pattern
   - Cache key: prompt template hash
```

**Verification checklist:**
- [ ] Prompt adapts to context size
- [ ] Core instructions never removed
- [ ] Cached prompts have invalidation on change

**Anti-pattern guards:**
- DO NOT remove safety-critical instructions
- DO NOT change prompt format (use established patterns)

---

## Phase 3: Trace Instrumentation & Observability

**Goal:** Enable data-driven optimization through comprehensive telemetry.

**Duration:** 2-3 days
**Risk:** Low - additive only

### 3.1 Implement OpenTelemetry Integration

**What to implement:**
- OpenTelemetry SDK for traces and metrics
- Span creation for each tool invocation
- Metric export for cost/latency tracking

**Documentation references:**
- Pattern: "Traces and spans are utilized to track decision pathways"
- Standard: OpenTelemetry GenAI conventions (in development)

**Implementation tasks:**
```
1. Add dependencies:
   - @opentelemetry/api
   - @opentelemetry/sdk-node
   - @opentelemetry/exporter-otlp-grpc
   - @opentelemetry/instrumentation-http

2. Create src/utils/telemetry.ts:
   - initializeTelemetry(): sets up SDK
   - createSpan(name, attrs): Span
   - recordMetric(name, value, attrs)
   - Environment: OTEL_EXPORTER_OTLP_ENDPOINT

3. Add instrumentation:
   - Tool wrapper: Auto-spans on every tool call
   - LLM calls: Track tokens, latency, model
   - Git operations: Track command, duration

4. Span hierarchy:
   Root Span (agent execution)
   ├─ LLM Call Span
   │  ├─ Tokens: input/output
   │  └─ Model: {name}
   ├─ Tool Call Span
   │  ├─ Tool: {name}
   │  ├─ Args: {sanitized}
   │  └─ Result: {success, size}
   └─ Git Operation Span
      ├─ Command: {name}
      └─ Duration: {ms}
```

**Verification checklist:**
- [ ] Spans exported to OTLP collector
- [ ] Token usage tracked per LLM call
- [ ] Tool invocations have duration and success rate
- [ ] Metrics visible in dashboard (Jaeger/Grafana)

**Anti-pattern guards:**
- DO NOT log sensitive data (PII, secrets) in spans
- DO NOT create spans for < 10ms operations (overhead)
- DO NOT mix trace and metric exporters

### 3.2 Add Token Usage Tracking

**What to implement:**
- Token counter for all LLM calls
- Budget enforcement with hard limits
- Cost estimation by model

**Documentation references:**
- Metric: "Token consumption, API usage, and infrastructure overhead"

**Implementation tasks:**
```
1. Create src/utils/token-tracker.ts:
   - trackTokenUsage(threadId, model, inputTokens, outputTokens)
   - getTokenUsage(threadId): TokenUsage
   - checkBudget(threadId, budget): boolean
   - Environment: MAX_TOKENS_PER_THREAD (default: 500k)

2. Cost estimation:
   - Model pricing map: MODEL_PRICING
   - calculateCost(model, inputTokens, outputTokens): number

3. Enforcement:
   - Pre-call budget check
   - Post-call accumulation
   - Over-budget error with actionable message
```

**Verification checklist:**
- [ ] Token usage logged for every LLM call
- [ ] Budget enforced before execution
- [ ] Cost estimation accurate to model pricing
- [ ] Usage persists across restarts (Supabase)

**Anti-pattern guards:**
- DO NOT rely on model-reported tokens (can be inaccurate)
- DO NOT silently continue when over budget
- DO NOT count cached prompts twice

### 3.3 Add Performance Metrics Dashboard

**What to implement:**
- Metrics export endpoint
- Performance summary per thread
- Alert thresholds for anomalies

**Documentation references:**
- Metric: "Request volumes, latency distributions"

**Implementation tasks:**
```
1. Add endpoint to src/webapp.ts:
   - GET /metrics/thread/:threadId
   - Returns: TokenUsage, ToolStats, Latency, Cost

2. Metrics structure:
   {
     threadId: string,
     duration: number,
     tokens: { input, output, total },
     cost: number,
     tools: {
       [name]: { count, errors, avgLatency }
     },
     llmCalls: {
       count: number,
       model: string,
       avgLatency: number
     }
   }

3. Add alerting:
   - High token usage: > 100k tokens
   - Tool loop: Same tool 5+ times consecutively
   - High latency: Single LLM call > 60s
```

**Verification checklist:**
- [ ] Metrics endpoint returns JSON
- [ ] Metrics updated in real-time
- [ ] Alerts logged when thresholds hit
- [ ] Historical metrics available (Supabase)

**Anti-pattern guards:**
- DO NOT expose sensitive data in public endpoints
- DO NOT store unbounded metric history
- DO NOT alert on every single error (use thresholds)

---

## Phase 4: File Discovery Optimization

**Goal:** Reduce token consumption during codebase exploration by 70-90%.

**Duration:** 4-5 days
**Risk:** Medium - new dependency on vector database

### 4.1 Implement Semantic Search

**What to implement:**
- Vector embeddings for code chunks
- Semantic similarity search
- Integration with existing code-search tool

**Documentation references:**
- Pattern: "Implementing semantic search tools fundamentally alters the execution trace"
- Result: "97% reduction in input tokens during search phase"

**Implementation tasks:**
```
1. Add dependencies:
   - @xenova/transformers (local embeddings)
   - Or OpenAI embeddings API

2. Create src/tools/semantic-search.ts:
   - indexRepository(repoPath, callback): void
   - semanticSearch(query, topK): SearchResult[]
   - Chunking: "agentic" (function/class level)

3. Agentic chunking strategy:
   - AST-based chunking
   - Preserve function/class boundaries
   - Include context (imports, dependencies)
   - Max chunk size: 500 tokens

4. Update code-search tool:
   - Try semantic search first
   - Fallback to regex if no results
   - Combine results with relevance score
```

**API Design:**
```typescript
// Index on first use or explicit call
await indexRepository(workspaceDir, {
  onProgress: (pct) => console.log(`Indexing: ${pct}%`)
});

// Semantic search
const results = await semanticSearch({
  query: "where is the auth middleware",
  topK: 5,
  filters: { language: "typescript" }
});
// Returns: [{ file, line, score, snippet }]

// Combined search
const combined = await combinedSearch({
  query: "AuthMiddleware",
  semantic: true,
  regex: true,
  topK: 10
});
```

**Verification checklist:**
- [ ] Index builds in reasonable time (< 30s for typical repo)
- [ ] Semantic results are relevant
- [ ] Fallback to regex works when index missing
- [ ] Index updates on file changes

**Anti-pattern guards:**
- DO NOT use paragraph-based chunking (severs code logic)
- DO NOT require index for basic search
- DO NOT store embeddings in context (only results)

### 4.2 Implement Progressive File Reading

**What to implement:**
- Line-range reading before full file
- Symbol-based navigation
- Dependency-aware loading

**Documentation references:**
- Pattern: "Systems utilize commands to read only the last lines or specific line ranges"

**Implementation tasks:**
```
1. Enhance src/tools/code-search.ts:
   - Add: readLines(filePath, start, end)
   - Add: readFunction(filePath, functionName)
   - Add: readImports(filePath) (first 50 lines)

2. Add symbol resolver:
   - Extract function/class definitions via AST
   - Map symbols to line ranges
   - Cache symbol tables

3. Progressive disclosure flow:
   - First: List files matching pattern
   - Second: Read imports/exports
   - Third: Read specific symbol/function
   - Last: Read full file (if needed)
```

**Verification checklist:**
- [ ] Line-range reading works without loading full file
- [ ] Symbol extraction handles TypeScript/JavaScript
- [ ] Progressive flow reduces token usage measurably

**Anti-pattern guards:**
- DO NOT read full file when line range sufficient
- DO NOT parse AST for every read (cache it)
- DO NOT extract symbols for generated files

### 4.3 Implement Search Tool Hierarchy

**What to implement:**
- Enforce search tool priority in system prompt
- Prevent brute-force globbing until semantic search exhausted
- Add search strategy guidance

**Documentation references:**
- Pattern: "Enforce a strict hierarchy in the system instructions"

**Implementation tasks:**
```
1. Update src/prompt.ts with search hierarchy:
   SEARCH TOOL PRIORITY:
   1. semantic-search: For conceptual queries ("where is auth?")
   2. code-search: For symbol queries ("find AuthMiddleware class")
   3. code-search regex: For pattern queries ("find console.log")
   4. sandbox-find: ONLY as last resort for file discovery

2. Add to system prompt:
   NEVER start with directory listing or file globbing.
   ALWAYS use semantic-search for feature discovery.
   ONLY use sandbox-find when semantic/code search fails.

3. Add validation middleware:
   - Warn if low-priority tool used before high-priority
   - Log violations for analysis
```

**Verification checklist:**
- [ ] Agent prefers semantic search
- [ ] Brute-force globbing reduced in traces
- [ ] Warnings logged for search violations

**Anti-pattern guards:**
- DO NOT block tool usage (only warn/guide)
- DO NOT hard-code all search patterns (allow flexibility)

---

## Phase 5: Verification & Testing

**Goal:** Ensure all improvements work correctly and don't break existing functionality.

**Duration:** 2-3 days
**Risk:** Low - testing phase

### 5.1 Create Regression Tests

**What to implement:**
- Tests for each optimization
- Trace-based tests for loop prevention
- Performance benchmarks

**Implementation tasks:**
```
1. Test suite src/test/performance.test.ts:
   - test invocation limits enforced
   - test memory pointer stores and retrieves
   - test context compaction preserves critical messages
   - test semantic search returns relevant results

2. Trace-based tests:
   - test_infinite_loop_prevented.ts
   - test_token_snowball_prevented.ts
   - test_large_file_handled_efficiently.ts

3. Benchmark suite:
   - benchmark file discovery (regex vs semantic)
   - benchmark context size over time
   - benchmark tool invocation overhead
```

**Verification checklist:**
- [ ] All tests pass
- [ ] Benchmarks show improvement
- [ ] No regressions in existing functionality

**Anti-pattern guards:**
- DO NOT skip tests for "simple" changes
- DO NOT rely on manual testing only

### 5.2 Create Trace Analysis Dashboard

**What to implement:**
- UI for viewing agent traces
- Performance metrics visualization
- Anomaly highlighting

**Implementation tasks:**
```
1. Add endpoint: GET /trace/:threadId
2. Create simple HTML dashboard:
   - Timeline view of tool calls
   - Token usage graph
   - Tool invocation heatmap
   - Highlighted anomalies
```

**Verification checklist:**
- [ ] Dashboard loads trace data
- [ ] Anomalies highlighted correctly
- [ ] Exportable for analysis

**Anti-pattern guards:**
- DO NOT build full-featured UI (keep it simple)
- DO NOT store trace data indefinitely

### 5.3 Documentation Updates

**What to implement:**
- Update CLAUDE.md with new capabilities
- Document configuration options
- Create troubleshooting guide

**Implementation tasks:**
```
1. Update CLAUDE.md:
   - Add new tools (semantic-search, artifact-query)
   - Add configuration (invocation limits, budgets)
   - Add observability section

2. Create docs/OPTIMIZATION.md:
   - How context compaction works
   - How to use semantic search effectively
   - How to interpret traces

3. Create docs/TROUBLESHOOTING.md:
   - Common agent failure modes
   - How to debug infinite loops
   - How to reduce token usage
```

**Verification checklist:**
- [ ] Docs are accurate to implementation
- [ ] Configuration examples work
- [ ] Troubleshooting covers common issues

---

## Implementation Order & Dependencies

```
Phase 1 (Tool Optimization)
├─ 1.1 Invocation Limits ────────┐
├─ 1.2 Error Responses ──────────┤
└─ 1.3 Response Limits ──────────┤
                                   ├─► Can run in parallel
Phase 2 (Context Engineering)     │
├─ 2.1 Memory Pointer ────────────┤
├─ 2.2 Context Compaction ────────┤
└─ 2.3 Prompt Compaction ─────────┘
                                   │
Phase 3 (Observability) ───────────┘
├─ 3.1 OpenTelemetry
├─ 3.2 Token Tracking
└─ 3.3 Metrics Dashboard
                                   │
Phase 4 (File Discovery) ◄─────────┘
├─ 4.1 Semantic Search
├─ 4.2 Progressive Reading
└─ 4.3 Search Hierarchy

Phase 5 (Verification) ◄─────────── All previous
└─ All verification tasks
```

**Critical Path:** Phase 1 → Phase 2 → Phase 5
**Can Parallelize:** Phase 3 (after Phase 1), Phase 4 (after Phase 1)

---

## Configuration & Environment Variables

```bash
# Tool Invocation Limits
TOOL_MAX_INVOCATIONS_DEFAULT=10
TOOL_DEBOUNCE_WINDOW_MS=5000
PER_TOOL_LIMITS_JSON={"sandbox_shell": 20, "code_search": 15}

# Context Management
CONTEXT_COMPACTION_THRESHOLD=50000
CONTEXT_KEEP_MINIMUM=30
CONTEXT_KEEP_IMPORTANT=20
MEMORY_POINTER_TTL_HOURS=24

# Token Budgeting
MAX_TOKENS_PER_THREAD=500000
MAX_COST_PER_THREAD=10.00

# Semantic Search
SEMANTIC_SEARCH_ENABLED=true
SEMANTIC_SEARCH_MODEL=xenova/all-MiniLM-L6-v2
SEMANTIC_SEARCH_INDEX_PATH=.semantic-index

# Observability
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
OTEL_SERVICE_NAME=bullhorse-agent
ENABLE_METRICS_ENDPOINT=true

# Sandbox
SANDBOX_TIMEOUT_SECONDS=300
SANDBOX_MAX_OUTPUT_LINES=10000
```

---

## Success Metrics

### Quantitative Goals

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Token usage (file discovery) | ~51k | < 5k | Trace analysis |
| Agent loop detection | Manual | Auto | Loop stop rate |
| Context compaction loss | High | < 5% | Message retention |
| Error recovery rate | Unknown | > 80% | Successful retry % |
| Trace visibility | Minimal | Complete | OTLP spans |

### Qualitative Goals

- Agent stops before wasting resources on unsolvable tasks
- Large files handled without context overflow
- Semantic search finds relevant code by meaning
- All errors include actionable next steps
- Performance issues visible in real-time

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Context compaction loses critical info | High | Extensive testing, gradual rollout with monitoring |
| Semantic search index size large | Medium | Configurable chunk size, lazy indexing |
| OpenTelemetry overhead | Low | Sampling for high-volume operations |
| Tool limits block valid work | Medium | Configurable per-tool, allow override |

---

## Next Steps

1. **Review and approve this plan** with team
2. **Set up development environment** with new dependencies
3. **Begin Phase 1.1** (Invocation Limits) - highest ROI
4. **Set up observability** (Phase 3) early to gather baseline metrics
5. **Iterate based on trace data** from real usage

---

## Appendix: Quick Reference

### File Changes Summary

| New File | Purpose |
|----------|---------|
| `src/middleware/tool-invocation-limits.ts` | Per-tool call tracking and debouncing |
| `src/utils/tool-error.ts` | Structured error with recovery steps |
| `src/utils/response-limit.ts` | Response truncation utilities |
| `src/utils/memory-pointer.ts` | Large artifact storage system |
| `src/utils/context-compactor.ts` | Progressive context compaction |
| `src/utils/prompt-manager.ts` | Dynamic prompt sizing |
| `src/utils/telemetry.ts` | OpenTelemetry integration |
| `src/utils/token-tracker.ts` | Token usage and budgeting |
| `src/tools/semantic-search.ts` | Vector-based code search |

| Modified File | Changes |
|---------------|---------|
| `src/harness/deepagents.ts` | Add middleware, replace context cleanup |
| `src/tools/*.ts` | Add response limits, better errors |
| `src/prompt.ts` | Add search hierarchy instructions |
| `src/webapp.ts` | Add metrics/trace endpoints |
| `CLAUDE.md` | Document new capabilities |

---

**Document Version:** 1.0
**Last Updated:** 2026-04-05
**Author:** Generated based on agent-trace-performance-analysis.md
