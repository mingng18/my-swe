# Memory System Design for Bullhorse

**Date:** 2026-04-11
**Status:** Approved
**Author:** Claude

---

## Overview

A persistent, cross-session memory system that captures conversation context, project knowledge, and enables semantic retrieval. Inspired by Claude Code's Auto Memory and memsearch architecture, adapted for Bullhorse's LangGraph-based agent pipeline.

### Goals

1. **Auto-capture memories** during agent turns (summaries, user preferences, decisions, references)
2. **Store in Supabase** with vector embeddings for semantic search
3. **Provide search tools** for the agent to recall relevant context
4. **Run background consolidation** to clean up stale/contradictory memories

---

## Memory Types

Four memory categories (mirroring Claude Code's Auto Memory):

| Type | Description | Examples |
|------|-------------|----------|
| `user` | User role, preferences, expertise level | "Backend engineer, fluent in Go, new to React" |
| `feedback` | Corrections and validated approaches | "Integration tests must use real DB, no mocking" |
| `project` | Decisions, context, ongoing work | "Auth rewrite driven by compliance, not tech debt" |
| `reference` | Where things live (external systems) | "Pipeline bugs tracked in Linear INGEST project" |

---

## Architecture

### Three-Layer Design

```
┌─────────────────────────────────────────────────────────────┐
│                      Agent Layer                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │    coder     │  │   linter     │  │ Memory       │       │
│  │    node      │  │    node      │  │ Extractor    │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
└─────────┼──────────────────┼──────────────────┼──────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                    Memory Service Layer                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  Memory      │  │  Embedding   │  │  Search      │       │
│  │  Repository  │  │  Service     │  │  Service     │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
└─────────┼──────────────────┼──────────────────┼──────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                    Supabase Layer                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │agent_memory  │  │   pgvector   │  │ Consolidation│       │
│  │    table     │  │    index     │  │    RPC       │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### Components

| Component | File | Responsibility |
|-----------|------|-----------------|
| `MemoryExtractor` | `src/memory/extractor.ts` | Analyze turns, extract relevant memories |
| `MemoryRepository` | `src/memory/repository.ts` | CRUD operations with Supabase |
| `EmbeddingService` | `src/memory/embeddings.ts` | Generate embeddings via OpenAI |
| `SearchService` | `src/memory/search.ts` | Semantic + keyword search |
| `ConsolidationService` | `src/memory/consolidation.ts` | Cleanup and merge stale memories |
| Memory tools | `src/tools/memory-*.ts` | Agent-accessible search/query tools |
| Background daemon | `src/memory/daemon.ts` | Scheduled consolidation runs |

---

## Database Schema

### Supabase Tables

```sql
-- Main memory table
CREATE TABLE agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id TEXT NOT NULL,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('user', 'feedback', 'project', 'reference')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR(1536), -- OpenAI embedding dimension
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  source_run_id UUID REFERENCES agent_run(id),
  is_active BOOLEAN DEFAULT true,
  access_count INTEGER DEFAULT 0,
  last_accessed_at TIMESTAMPTZ
);

-- Index for semantic search
CREATE INDEX agent_memory_embedding_idx ON agent_memory
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Index for lookup by thread/type
CREATE INDEX agent_memory_thread_idx ON agent_memory(thread_id, memory_type, is_active);

-- Index for consolidation queries
CREATE INDEX agent_memory_expires_at_idx ON agent_memory(expires_at) WHERE is_active = true;

-- Consolidation log
CREATE TABLE agent_memory_consolidation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  memories_processed INTEGER,
  memories_merged INTEGER,
  memories_archived INTEGER,
  errors TEXT
);
```

---

## Data Flow

### Memory Capture Flow

```
Agent Turn Result
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│  MemoryExtractor.extractFromTurn(turn)                  │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 1. Analyze user messages → extract preferences  │    │
│  │ 2. Analyze agent responses → extract decisions   │    │
│  │ 3. Check for corrections → extract feedback      │    │
│  │ 4. Detect external systems → extract references  │    │
│  └─────────────────────────────────────────────────┘    │
│                        │                                  │
│                        ▼                                  │
│  Returns: Memory[] { type, title, content, metadata }    │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  MemoryRepository.save(memories)                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 1. Generate embeddings via EmbeddingService      │    │
│  │ 2. Insert batch to Supabase agent_memory        │    │
│  │ 3. Update memory index stats                    │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### Extraction Patterns

| Trigger | Memory Type | Example |
|---------|-------------|---------|
| User says "I prefer X" | `user` | "I prefer TypeScript over JavaScript" |
| User says "don't do X" | `feedback` | "Don't mock the database" |
| Agent makes architecture decision | `project` | "Chose Supabase over PostgreSQL for auth" |
| Reference to external system | `reference` | "Bugs tracked in Linear INGEST" |
| Tool discovers config | `project` | "Found Redis on port 6380 in docker-compose" |
| User correction | `feedback` | "No, use the OAuth2 flow not JWT" |

---

## Agent Tools

### Tool Definitions

| Tool | Purpose | Usage |
|------|---------|-------|
| `memory_search` | Semantic + keyword search | "Find memories about Redis config" |
| `memory_get` | Retrieve specific memory by ID | After search, get full content |
| `memory_forget` | Remove incorrect/outdated memory | User says "that's wrong, forget it" |

### Tool Schemas

```typescript
// memory_search
{
  query: string,           // Natural language query
  types?: string[],        // Filter by type ['user', 'feedback', 'project', 'reference']
  limit?: number,          // Max results (default 5)
  hybrid?: boolean         // Combine semantic + keyword (default true)
}

// memory_get
{
  memory_id: string,       // UUID from search results
  include_related?: boolean // Also return related memories
}

// memory_forget
{
  memory_id: string,
  reason?: string          // Why it's being forgotten (for audit)
}
```

### Search Result Format

```json
{
  "results": [
    {
      "id": "uuid",
      "type": "project",
      "title": "Redis port configuration",
      "preview": "Redis configured on port 6380 due to conflict...",
      "relevance_score": 0.92,
      "created_at": "2026-04-10T15:30:00Z",
      "metadata": { "source": "tool_discovery" }
    }
  ],
  "total_found": 3
}
```

---

## Background Consolidation Daemon

### Consolidation Flow

```
┌─────────────────────────────────────────────────────────┐
│  Consolidation Daemon (runs every 6 hours)             │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Trigger conditions:                             │    │
│  │ - 24+ hours since last run                      │    │
│  │ - 5+ new sessions accumulated                   │    │
│  │ - Or manual trigger via /memory-consolidate      │    │
│  └─────────────────────────────────────────────────┘    │
│                        │                                  │
│                        ▼                                  │
│  ┌─────────────────────────────────────────────────┐    │
│  │ ConsolidationService.consolidate()              │    │
│  │ 1. Find stale memories (90+ days old)           │    │
│  │ 2. Detect contradictions (same type, same topic) │    │
│  │ 3. Merge related memories                       │    │
│  │ 4. Mark obsolete as is_active=false             │    │
│  │ 5. Resolve vague time references → exact dates  │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### Consolidation Rules

| Rule | Action |
|------|--------|
| Duplicate detection | Same type + 0.9+ similarity → merge |
| Time reference resolution | "yesterday" → "2026-04-09" |
| Stale expiration | 90+ days old, never accessed → archive |
| Contradiction resolution | Keep newest, mark old as superseded |

### Configuration

```bash
MEMORY_CONSOLIDATION_INTERVAL_HOURS=6
MEMORY_CONSOLIDATION_MIN_SESSIONS=5
MEMORY_CONSOLIDATION_STALE_DAYS=90
```

---

## Integration with Bullhorse

### Integration Points

| Location | Change | Purpose |
|----------|--------|---------|
| `src/blueprints/retry-loop.ts` | Add memory pre-search | Inject context before coder |
| `src/nodes/deterministic/LinterNode.ts` | Post-turn memory extraction | Capture after deterministic completes |
| `src/tools/index.ts` | Register memory tools | Agent can search/forget |
| `src/webapp.ts` | Add consolidation endpoint | Manual trigger + health check |

### Flow with Memory

```
┌─────────────────────────────────────────────────────────────┐
│                   Existing Flow                             │
│  User Input → Coder Node → Linter Node → Response          │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼ (add hooks)
┌─────────────────────────────────────────────────────────────┐
│                   With Memory                               │
│                                                             │
│  1. BEFORE coder node:                                      │
│     └─ Search relevant memories, inject into system prompt  │
│                                                             │
│  2. AFTER linter node (turn complete):                      │
│     └─ Extract memories from turn results                   │
│     └─ Store to Supabase with embeddings                    │
│                                                             │
│  3. Background:                                             │
│     └─ Consolidation daemon runs independently             │
└─────────────────────────────────────────────────────────────┘
```

---

## Error Handling & Resilience

### Safety Wrapper Pattern

```typescript
async function safeMemoryOperation<T>(
  operation: string,
  fn: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logger.warn({ operation, error }, "[memory] Non-fatal error");
    return fallback;
  }
}
```

### Resilience Guarantees

| Scenario | Behavior |
|----------|----------|
| Supabase down | Continue without memory, log warning |
| Embedding API fails | Save memory without embedding, retry later |
| Search timeout | Return empty results, don't block |
| Invalid memory data | Skip and log, continue processing |

### Retry Policy for Embeddings

- Initial attempt: immediate
- Retry 1: 5 seconds
- Retry 2: 30 seconds
- After 3 failures: mark for background retry

---

## Environment Variables

```bash
# Memory System
MEMORY_ENABLED=true
MEMORY_EMBEDDING_MODEL=text-embedding-3-small
MEMORY_SIMILARITY_THRESHOLD=0.75
MEMORY_MAX_RESULTS=5

# Consolidation
MEMORY_CONSOLIDATION_ENABLED=true
MEMORY_CONSOLIDATION_INTERVAL_HOURS=6
MEMORY_CONSOLIDATION_MIN_SESSIONS=5
MEMORY_CONSOLIDATION_STALE_DAYS=90

# Supabase (existing)
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

---

## Testing Strategy

### Unit Tests

| File | What to Test |
|------|--------------|
| `memory/extractor.test.ts` | Extraction patterns from sample turns |
| `memory/search.test.ts` | Search ranking, similarity scoring |
| `memory/consolidation.test.ts` | Merge logic, contradiction detection |

### Integration Tests

| Test | Coverage |
|------|----------|
| `memory/integration.test.ts` | Full flow: extract → embed → save → search |
| `tools/memory-tools.test.ts` | Tool invocation via LangChain |
| `daemon/consolidation.e2e.test.ts` | Background job execution |

---

## Implementation Phases

### Phase 1: Foundation (MVP)
- Memory repository with Supabase schema
- Basic extraction (user preferences, feedback)
- Simple search (keyword only, no embeddings)
- Memory tools (`memory_search`, `memory_get`, `memory_forget`)

### Phase 2: Semantic Search
- Embedding service integration
- Vector index setup in Supabase
- Hybrid semantic + keyword search

### Phase 3: Consolidation
- Consolidation service logic
- Background daemon setup
- Manual consolidation endpoint

### Phase 4: Enhancement
- Advanced extraction patterns (decisions, references)
- Related memory suggestions
- Memory analytics dashboard

### Estimated Effort

| Phase | Files to Create | Files to Modify |
|-------|-----------------|-----------------|
| 1 | 6 new | 3 existing |
| 2 | 2 new | 1 existing |
| 3 | 2 new | 2 existing |
| 4 | 4 new | 1 existing |

---

## References

- [Claude Code Memory System Explained](https://milvus.io/blog/claude-code-memory-memsearch.md)
- [memsearch GitHub](https://github.com/zilliztech/memsearch)
- [Supabase Vector Columns](https://supabase.com/docs/guides/ai/vector-columns)
- [LangGraph State Management](https://langchain-ai.github.io/langgraph/concepts/low_level/#state)
