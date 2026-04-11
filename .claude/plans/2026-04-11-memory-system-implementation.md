# Memory System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent, cross-session memory system for Bullhorse that captures conversation context, project knowledge, and enables semantic retrieval.

**Architecture:** Three-layer design (Agent → Memory Service → Supabase) with four memory types (user, feedback, project, reference), semantic search via pgvector, and background consolidation.

**Tech Stack:** Supabase (pgvector), OpenAI embeddings, LangChain tools, Node.js/Bun runtime

---

## File Structure

```
src/memory/
├── types.ts              # Shared type definitions
├── repository.ts         # CRUD operations with Supabase
├── extractor.ts          # Memory extraction from turns
├── embeddings.ts         # OpenAI embedding service
├── search.ts             # Semantic + keyword search
├── consolidation.ts      # Cleanup and merge logic
└── daemon.ts             # Background consolidation scheduler

src/tools/
├── memory-search.ts      # Agent search tool
├── memory-get.ts         # Retrieve specific memory
└── memory-forget.ts      # Remove incorrect memory

migrations/
└── 20260411_memory_system.sql  # Supabase schema
```

---

## Phase 1: Foundation (MVP)

### Task 1: Create Shared Type Definitions

**Files:**
- Create: `src/memory/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
/**
 * Memory type categories matching Claude Code's Auto Memory
 */
export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

/**
 * A memory extracted from an agent turn
 */
export interface Memory {
  id?: string;
  threadId: string;
  type: MemoryType;
  title: string;
  content: string;
  embedding?: number[];
  metadata: Record<string, unknown>;
  createdAt?: Date;
  expiresAt?: Date;
  sourceRunId?: string;
  isActive?: boolean;
  accessCount?: number;
  lastAccessedAt?: Date;
}

/**
 * Extracted memory before saving (no ID/timestamps)
 */
export interface ExtractedMemory {
  type: MemoryType;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
}

/**
 * Search result with relevance score
 */
export interface MemorySearchResult {
  id: string;
  type: MemoryType;
  title: string;
  preview: string;
  relevanceScore: number;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

/**
 * Search options
 */
export interface MemorySearchOptions {
  query: string;
  types?: MemoryType[];
  limit?: number;
  hybrid?: boolean;
  similarityThreshold?: number;
  threadIds?: string[];
}

/**
 * Consolidation result
 */
export interface ConsolidationResult {
  processed: number;
  merged: number;
  archived: number;
  errors: string[];
}

/**
 * Turn result for memory extraction
 */
export interface TurnResult {
  threadId: string;
  userText: string;
  input: string;
  agentReply?: string;
  agentError?: string;
  plan?: string;
  fixAttempt?: string;
  deterministic: {
    formatResults?: { success: boolean; output?: string };
    linterResults?: { success: boolean; exitCode?: number; output?: string };
    testResults?: { passed: boolean; summary?: string; output?: string };
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/memory/types.ts
git commit -m "feat(memory): add shared type definitions"
```

---

### Task 2: Create Supabase Migration Schema

**Files:**
- Create: `migrations/20260411_memory_system.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Main memory table
CREATE TABLE IF NOT EXISTS agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id TEXT NOT NULL,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('user', 'feedback', 'project', 'reference')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR(1536),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  source_run_id UUID,
  is_active BOOLEAN DEFAULT true,
  access_count INTEGER DEFAULT 0,
  last_accessed_at TIMESTAMPTZ
);

-- Index for semantic search (IVFFlat for approximate nearest neighbor)
CREATE INDEX IF NOT EXISTS agent_memory_embedding_idx
  ON agent_memory
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Index for lookup by thread/type/active
CREATE INDEX IF NOT EXISTS agent_memory_thread_idx
  ON agent_memory(thread_id, memory_type, is_active);

-- Index for active memories with expiration
CREATE INDEX IF NOT EXISTS agent_memory_expires_at_idx
  ON agent_memory(expires_at)
  WHERE is_active = true;

-- Index for full-text search on title and content
CREATE INDEX IF NOT EXISTS agent_memory_content_idx
  ON agent_memory
  USING gin(to_tsvector('english', title || ' ' || content));

-- Consolidation log table
CREATE TABLE IF NOT EXISTS agent_memory_consolidation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  memories_processed INTEGER DEFAULT 0,
  memories_merged INTEGER DEFAULT 0,
  memories_archived INTEGER DEFAULT 0,
  errors TEXT
);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER update_agent_memory_updated_at
  BEFORE UPDATE ON agent_memory
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Helper function: cosine similarity search
CREATE OR REPLACE FUNCTION search_memories(
  p_thread_id TEXT,
  p_query_embedding VECTOR(1536),
  p_memory_types TEXT[] DEFAULT NULL,
  p_limit INTEGER DEFAULT 10,
  p_threshold FLOAT DEFAULT 0.75
)
RETURNS TABLE (
  id UUID,
  thread_id TEXT,
  memory_type TEXT,
  title TEXT,
  content TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    am.id,
    am.thread_id,
    am.memory_type,
    am.title,
    am.content,
    am.metadata,
    am.created_at,
    1 - (am.embedding <=> p_query_embedding) AS similarity
  FROM agent_memory am
  WHERE
    am.thread_id = p_thread_id
    AND am.is_active = true
    AND (p_memory_types IS NULL OR am.memory_type = ANY(p_memory_types))
    AND am.embedding IS NOT NULL
    AND (1 - (am.embedding <=> p_query_embedding)) >= p_threshold
  ORDER BY am.embedding <=> p_query_embedding
  LIMIT p_limit;
END;
$$;

-- Helper function: full-text search
CREATE OR REPLACE FUNCTION search_memories_fts(
  p_thread_id TEXT,
  p_query TEXT,
  p_memory_types TEXT[] DEFAULT NULL,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  thread_id TEXT,
  memory_type TEXT,
  title TEXT,
  content TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ,
  rank FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    am.id,
    am.thread_id,
    am.memory_type,
    am.title,
    am.content,
    am.metadata,
    am.created_at,
    ts_rank(to_tsvector('english', am.title || ' ' || am.content), plainto_tsquery('english', p_query)) AS rank
  FROM agent_memory am
  WHERE
    am.thread_id = p_thread_id
    AND am.is_active = true
    AND (p_memory_types IS NULL OR am.memory_type = ANY(p_memory_types))
    AND to_tsvector('english', am.title || ' ' || am.content) @@ plainto_tsquery('english', p_query)
  ORDER BY rank DESC
  LIMIT p_limit;
END;
$$;
```

- [ ] **Step 2: Commit**

```bash
git add migrations/20260411_memory_system.sql
git commit -m "feat(memory): add Supabase migration schema with pgvector support"
```

---

### Task 3: Create Memory Repository

**Files:**
- Create: `src/memory/repository.ts`

- [ ] **Step 1: Write failing tests first**

```typescript
// src/memory/__tests__/repository.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { MemoryRepository } from '../repository';
import type { Memory, MemoryType } from '../types';

describe('MemoryRepository', () => {
  let repo: MemoryRepository;
  const testThreadId = 'test-thread-' + Date.now();

  beforeAll(() => {
    repo = new MemoryRepository();
  });

  it('should save a memory', async () => {
    const memory: Memory = {
      threadId: testThreadId,
      type: 'user',
      title: 'Test preference',
      content: 'User prefers TypeScript',
      metadata: { source: 'test' }
    };

    const saved = await repo.save(memory);
    expect(saved.id).toBeDefined();
    expect(saved.threadId).toBe(testThreadId);
  });

  it('should retrieve a memory by ID', async () => {
    const memory: Memory = {
      threadId: testThreadId,
      type: 'feedback',
      title: 'Test feedback',
      content: 'Do not mock database',
      metadata: {}
    };

    const saved = await repo.save(memory);
    const retrieved = await repo.getById(saved.id!);

    expect(retrieved).toBeDefined();
    expect(retrieved?.title).toBe('Test feedback');
  });

  it('should search memories by thread', async () => {
    const results = await repo.getByThread(testThreadId);
    expect(results.length).toBeGreaterThan(0);
  });

  it('should delete a memory (soft delete)', async () => {
    const memory: Memory = {
      threadId: testThreadId,
      type: 'project',
      title: 'To be deleted',
      content: 'Temporary memory',
      metadata: {}
    };

    const saved = await repo.save(memory);
    await repo.softDelete(saved.id!);

    const retrieved = await repo.getById(saved.id!);
    expect(retrieved?.isActive).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/memory/__tests__/repository.test.ts
```
Expected: FAIL with "Cannot find module '../repository'" or "MemoryRepository is not defined"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/memory/repository.ts
import { createLogger } from '../utils/logger';
import type { Memory, MemoryType, ExtractedMemory } from './types';

const logger = createLogger('memory-repository');

interface SupabaseMemoryRow {
  id: string;
  thread_id: string;
  memory_type: string;
  title: string;
  content: string;
  embedding: number[] | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  source_run_id: string | null;
  is_active: boolean;
  access_count: number;
  last_accessed_at: string | null;
}

/**
 * Repository for memory CRUD operations with Supabase
 */
export class MemoryRepository {
  private supabaseUrl: string;
  private supabaseKey: string;

  constructor() {
    this.supabaseUrl = process.env.SUPABASE_URL || '';
    this.supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

    if (!this.supabaseUrl || !this.supabaseKey) {
      logger.warn('[MemoryRepository] Supabase credentials not configured');
    }
  }

  /**
   * Save a memory to Supabase
   */
  async save(memory: Memory): Promise<Memory> {
    const row = this.toRow(memory);

    const response = await fetch(`${this.supabaseUrl}/rest/v1/agent_memory`, {
      method: 'POST',
      headers: {
        apikey: this.supabaseKey,
        Authorization: `Bearer ${this.supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(row)
    });

    if (!response.ok) {
      const error = await response.text();
      logger.warn({ error }, '[MemoryRepository] Failed to save memory');
      throw new Error(`Failed to save memory: ${error}`);
    }

    const [saved] = await response.json() as SupabaseMemoryRow[];
    return this.fromRow(saved);
  }

  /**
   * Save multiple memories in batch
   */
  async saveBatch(memories: Memory[]): Promise<Memory[]> {
    if (memories.length === 0) return [];

    const rows = memories.map(m => this.toRow(m));

    const response = await fetch(`${this.supabaseUrl}/rest/v1/agent_memory`, {
      method: 'POST',
      headers: {
        apikey: this.supabaseKey,
        Authorization: `Bearer ${this.supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(rows)
    });

    if (!response.ok) {
      const error = await response.text();
      logger.warn({ error }, '[MemoryRepository] Failed to save memories batch');
      throw new Error(`Failed to save memories: ${error}`);
    }

    const saved = await response.json() as SupabaseMemoryRow[];
    return saved.map(row => this.fromRow(row));
  }

  /**
   * Get a memory by ID
   */
  async getById(id: string): Promise<Memory | null> {
    const response = await fetch(
      `${this.supabaseUrl}/rest/v1/agent_memory?id=eq.${id}&is_active=eq.true`,
      {
        headers: {
          apikey: this.supabaseKey,
          Authorization: `Bearer ${this.supabaseKey}`,
          Accept: 'application/json'
        }
      }
    );

    if (!response.ok) {
      logger.warn({ id }, '[MemoryRepository] Failed to get memory');
      return null;
    }

    const [row] = await response.json() as SupabaseMemoryRow[];
    if (!row) return null;

    // Update access count
    await this.incrementAccessCount(id);

    return this.fromRow(row);
  }

  /**
   * Get all memories for a thread
   */
  async getByThread(threadId: string, types?: MemoryType[]): Promise<Memory[]> {
    let url = `${this.supabaseUrl}/rest/v1/agent_memory?thread_id=eq.${threadId}&is_active=eq.true&order=created_at.desc`;

    if (types && types.length > 0) {
      url += `&memory_type=in.(${types.join(',')})`;
    }

    const response = await fetch(url, {
      headers: {
        apikey: this.supabaseKey,
        Authorization: `Bearer ${this.supabaseKey}`,
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      logger.warn({ threadId }, '[MemoryRepository] Failed to get memories by thread');
      return [];
    }

    const rows = await response.json() as SupabaseMemoryRow[];
    return rows.map(row => this.fromRow(row));
  }

  /**
   * Soft delete a memory (set is_active = false)
   */
  async softDelete(id: string): Promise<void> {
    await fetch(`${this.supabaseUrl}/rest/v1/agent_memory?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        apikey: this.supabaseKey,
        Authorization: `Bearer ${this.supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ is_active: false })
    });
  }

  /**
   * Permanently delete a memory
   */
  async delete(id: string): Promise<void> {
    await fetch(`${this.supabaseUrl}/rest/v1/agent_memory?id=eq.${id}`, {
      method: 'DELETE',
      headers: {
        apikey: this.supabaseKey,
        Authorization: `Bearer ${this.supabaseKey}`
      }
    });
  }

  /**
   * Update a memory
   */
  async update(id: string, updates: Partial<Memory>): Promise<Memory | null> {
    const row: Partial<SupabaseMemoryRow> = {};

    if (updates.title) row.title = updates.title;
    if (updates.content) row.content = updates.content;
    if (updates.metadata) row.metadata = updates.metadata as Record<string, unknown>;
    if (updates.embedding) row.embedding = updates.embedding;
    if (updates.expiresAt) row.expires_at = updates.expiresAt.toISOString();

    const response = await fetch(`${this.supabaseUrl}/rest/v1/agent_memory?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        apikey: this.supabaseKey,
        Authorization: `Bearer ${this.supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(row)
    });

    if (!response.ok) {
      logger.warn({ id }, '[MemoryRepository] Failed to update memory');
      return null;
    }

    const [updated] = await response.json() as SupabaseMemoryRow[];
    return this.fromRow(updated);
  }

  /**
   * Increment access count for a memory
   */
  private async incrementAccessCount(id: string): Promise<void> {
    await fetch(`${this.supabaseUrl}/rest/v1/agent_memory?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        apikey: this.supabaseKey,
        Authorization: `Bearer ${this.supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        last_accessed_at: new Date().toISOString(),
        access_count: 1 // Use RPC for proper increment
      })
    }).catch(() => {
      // Non-fatal, ignore errors
    });
  }

  /**
   * Convert Memory domain object to Supabase row
   */
  private toRow(memory: Memory): SupabaseMemoryRow {
    return {
      id: memory.id || crypto.randomUUID(),
      thread_id: memory.threadId,
      memory_type: memory.type,
      title: memory.title,
      content: memory.content,
      embedding: memory.embedding || null,
      metadata: memory.metadata,
      created_at: memory.createdAt?.toISOString() || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      expires_at: memory.expiresAt?.toISOString() || null,
      source_run_id: memory.sourceRunId || null,
      is_active: memory.isActive !== undefined ? memory.isActive : true,
      access_count: memory.accessCount || 0,
      last_accessed_at: memory.lastAccessedAt?.toISOString() || null
    };
  }

  /**
   * Convert Supabase row to Memory domain object
   */
  private fromRow(row: SupabaseMemoryRow): Memory {
    return {
      id: row.id,
      threadId: row.thread_id,
      type: row.memory_type as MemoryType,
      title: row.title,
      content: row.content,
      embedding: row.embedding || undefined,
      metadata: row.metadata,
      createdAt: new Date(row.created_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
      sourceRunId: row.source_run_id || undefined,
      isActive: row.is_active,
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at ? new Date(row.last_accessed_at) : undefined
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test src/memory/__tests__/repository.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/memory/repository.ts src/memory/__tests__/repository.test.ts
git commit -m "feat(memory): add MemoryRepository with CRUD operations"
```

---

### Task 4: Create Memory Extractor

**Files:**
- Create: `src/memory/extractor.ts`
- Create: `src/memory/__tests__/extractor.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/memory/__tests__/extractor.test.ts
import { describe, it, expect } from 'bun:test';
import { MemoryExtractor } from '../extractor';
import type { TurnResult } from '../types';

describe('MemoryExtractor', () => {
  const extractor = new MemoryExtractor();

  it('should extract user preferences', () => {
    const turn: TurnResult = {
      threadId: 'test-thread',
      userText: 'I prefer using TypeScript strict mode',
      input: 'Add type checking',
      agentReply: 'I will enable strict mode'
    };

    const memories = extractor.extractFromTurn(turn);
    const userMemories = memories.filter(m => m.type === 'user');

    expect(userMemories.length).toBeGreaterThan(0);
    expect(userMemories[0].title).toContain('TypeScript');
  });

  it('should extract feedback from corrections', () => {
    const turn: TurnResult = {
      threadId: 'test-thread',
      userText: 'No, don\'t mock the database in tests',
      input: 'Add database tests',
      agentReply: 'I will use real database connection'
    };

    const memories = extractor.extractFromTurn(turn);
    const feedback = memories.filter(m => m.type === 'feedback');

    expect(feedback.length).toBeGreaterThan(0);
    expect(feedback[0].content).toContain('mock');
  });

  it('should extract project decisions', () => {
    const turn: TurnResult = {
      threadId: 'test-thread',
      userText: 'Should we use Supabase or direct PostgreSQL?',
      input: 'Decide on auth backend',
      agentReply: 'I will use Supabase for auth since it handles row-level security',
      plan: 'Implement Supabase auth with RLS'
    };

    const memories = extractor.extractFromTurn(turn);
    const projectMemories = memories.filter(m => m.type === 'project');

    expect(projectMemories.length).toBeGreaterThan(0);
    expect(projectMemories[0].content).toContain('Supabase');
  });

  it('should extract external system references', () => {
    const turn: TurnResult = {
      threadId: 'test-thread',
      userText: 'Track the bug in Linear',
      input: 'Create Linear ticket for the crash',
      agentReply: 'Created ticket in INGEST project'
    };

    const memories = extractor.extractFromTurn(turn);
    const references = memories.filter(m => m.type === 'reference');

    expect(references.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/memory/__tests__/extractor.test.ts
```
Expected: FAIL with "Cannot find module '../extractor'"

- [ ] **Step 3: Write implementation**

```typescript
// src/memory/extractor.ts
import { createLogger } from '../utils/logger';
import type { ExtractedMemory, TurnResult } from './types';

const logger = createLogger('memory-extractor');

/**
 * Extract memories from an agent turn
 */
export class MemoryExtractor {
  /**
   * Analyze a turn and extract relevant memories
   */
  extractFromTurn(turn: TurnResult): ExtractedMemory[] {
    const memories: ExtractedMemory[] = [];

    // Extract from user messages
    memories.push(...this.extractFromUserMessage(turn));

    // Extract from agent responses
    memories.push(...this.extractFromAgentResponse(turn));

    // Extract from tool results
    memories.push(...this.extractFromToolResults(turn));

    // Deduplicate by title
    return this.deduplicate(memories);
  }

  /**
   * Extract memories from user messages
   */
  private extractFromUserMessage(turn: TurnResult): ExtractedMemory[] {
    const memories: ExtractedMemory[] = [];
    const { userText, input } = turn;

    // Check for preferences ("I prefer", "I like", "I want")
    const prefPattern = /(?:i prefer|i'd like|i want|i like|use|don't use|avoid)\s+(.+)/i;
    const prefMatch = userText.match(prefPattern);

    if (prefMatch) {
      memories.push({
        type: 'user',
        title: this.generateTitle('Preference', prefMatch[1]),
        content: `User preference: ${prefMatch[0]}`,
        metadata: { source: 'user_message', timestamp: new Date().toISOString() }
      });
    }

    // Check for expertise/role statements
    const rolePattern = /(?:i am|i'm|i'm a|i'm an|i'm not|i'm new to|i'm experienced in)\s+(.+)/i;
    const roleMatch = userText.match(rolePattern);

    if (roleMatch) {
      memories.push({
        type: 'user',
        title: 'User expertise level',
        content: `User background: ${roleMatch[0]}`,
        metadata: { source: 'user_message', expertise: true }
      });
    }

    return memories;
  }

  /**
   * Extract memories from agent responses
   */
  private extractFromAgentResponse(turn: TurnResult): ExtractedMemory[] {
    const memories: ExtractedMemory[] = [];
    const { agentReply, plan } = turn;

    if (!agentReply && !plan) return memories;

    const fullResponse = [agentReply, plan].filter(Boolean).join('\n');

    // Check for architecture decisions
    const decisionPatterns = [
      /(?:i will|we'll|let's|going to|decided to|chose|chosen)\s+(?:use|implement|add|integrate)\s+(.+?)(?:\.|$)/gi,
      /(?:architecture|design|approach|solution|implementing?|using)\s+(?:will be|is|:)\s+(.+?)(?:\.|$)/gi
    ];

    for (const pattern of decisionPatterns) {
      const matches = fullResponse.match(pattern);
      if (matches) {
        for (const match of matches) {
          memories.push({
            type: 'project',
            title: this.generateTitle('Architecture decision', match),
            content: match.trim(),
            metadata: { source: 'agent_decision' }
          });
        }
      }
    }

    // Check for tech stack choices
    const techPattern = /(?:using|with|via|through)\s+([A-Z][a-zA-Z0-9+/#]+)/g;
    const techMatches = fullResponse.matchAll(techPattern);

    for (const match of techMatches) {
      if (match[1]) {
        memories.push({
          type: 'project',
          title: `Tech stack: ${match[1]}`,
          content: `Using ${match[1]} for this project`,
          metadata: { tech: match[1], source: 'tech_detection' }
        });
      }
    }

    return memories;
  }

  /**
   * Extract memories from tool results
   */
  private extractFromToolResults(turn: TurnResult): ExtractedMemory[] {
    const memories: ExtractedMemory[] = [];

    // Extract from linter results
    if (turn.deterministic.linterResults) {
      const { output } = turn.deterministic.linterResults;
      if (output && output.includes('error')) {
        memories.push({
          type: 'project',
          title: 'Linter errors detected',
          content: `Linter found issues: ${output.substring(0, 200)}`,
          metadata: { source: 'linter', hasErrors: true }
        });
      }
    }

    // Extract from test results
    if (turn.deterministic.testResults) {
      const { passed, summary } = turn.deterministic.testResults;
      if (!passed && summary) {
        memories.push({
          type: 'project',
          title: 'Test failures',
          content: `Tests failed: ${summary}`,
          metadata: { source: 'tests', passed: false }
        });
      }
    }

    return memories;
  }

  /**
   * Extract feedback (corrections, validated approaches)
   */
  private extractFromAgentResponse(turn: TurnResult): ExtractedMemory[] {
    const memories: ExtractedMemory[] = [];
    const { userText } = turn;

    // Check for corrections ("no", "don't", "not that", "wrong")
    const correctionPattern = /^(?:no|no,|don't|don't|not|stop|wrong|incorrect)/i;
    if (correctionPattern.test(userText.trim())) {
      memories.push({
        type: 'feedback',
        title: this.generateTitle('User correction', userText),
        content: `User correction: ${userText}`,
        metadata: { source: 'user_correction', timestamp: new Date().toISOString() }
      });
    }

    // Check for validated approaches ("yes", "correct", "that's right", "perfect")
    const validationPattern = /^(?:yes|yes!|correct|that's right|perfect|exactly|great)/i;
    if (validationPattern.test(userText.trim())) {
      memories.push({
        type: 'feedback',
        title: 'Validated approach',
        content: `User validated the approach: ${userText}`,
        metadata: { source: 'user_validation', validated: true }
      });
    }

    return memories;
  }

  /**
   * Detect external system references
   */
  private extractFromUserMessage(turn: TurnResult): ExtractedMemory[] {
    const memories: ExtractedMemory[] = [];
    const { userText } = turn;

    // Common external systems
    const systems = [
      { name: 'Linear', pattern: /linear/i },
      { name: 'GitHub', pattern: /github/i },
      { name: 'Jira', pattern: /jira/i },
      { name: 'Slack', pattern: /slack/i },
      { name: 'Notion', pattern: /notion/i },
      { name: 'Confluence', pattern: /confluence/i },
      { name: 'Figma', pattern: /figma/i },
      { name: 'Miro', pattern: /miro/i }
    ];

    for (const system of systems) {
      if (system.pattern.test(userText)) {
        memories.push({
          type: 'reference',
          title: `External system: ${system.name}`,
          content: `User mentioned ${system.name}: ${userText}`,
          metadata: { system: system.name, source: 'external_system' }
        });
      }
    }

    return memories;
  }

  /**
   * Generate a concise title
   */
  private generateTitle(prefix: string, content: string): string {
    const maxLength = 60;
    let title = content.trim();

    // Remove common filler words
    title = title.replace(/^(the|a|an)\s+/i, '');

    // Truncate if too long
    if (title.length > maxLength) {
      title = title.substring(0, maxLength - 3) + '...';
    }

    return `${prefix}: ${title}`;
  }

  /**
   * Remove duplicate memories by title
   */
  private deduplicate(memories: ExtractedMemory[]): ExtractedMemory[] {
    const seen = new Set<string>();
    return memories.filter(m => {
      const key = `${m.type}:${m.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test src/memory/__tests__/extractor.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/memory/extractor.ts src/memory/__tests__/extractor.test.ts
git commit -m "feat(memory): add MemoryExtractor for turn analysis"
```

---

### Task 5: Create Memory Search Tool

**Files:**
- Create: `src/tools/memory-search.ts`

- [ ] **Step 1: Write the tool**

```typescript
// src/tools/memory-search.ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { MemoryRepository } from '../memory/repository';
import type { MemoryType, MemorySearchOptions, MemorySearchResult } from '../memory/types';
import { createLogger } from '../utils/logger';

const logger = createLogger('memory-search-tool');

/**
 * Search memories using semantic and full-text search
 */
export const memorySearchTool = tool(
  async ({ query, types, limit = 5, hybrid = true }, config) => {
    const threadId = config?.configurable?.thread_id as string;
    if (!threadId) {
      return JSON.stringify({ error: 'Missing thread_id' });
    }

    const repo = new MemoryRepository();
    const results: MemorySearchResult[] = [];

    try {
      // First, get all memories for the thread (filtering by type if specified)
      const allMemories = await repo.getByThread(threadId, types);

      // Simple keyword matching for MVP (semantic search in Phase 2)
      const queryLower = query.toLowerCase();
      const keywords = queryLower.split(/\s+/).filter(w => w.length > 2);

      for (const memory of allMemories) {
        const titleLower = memory.title.toLowerCase();
        const contentLower = memory.content.toLowerCase();

        // Calculate simple relevance score
        let score = 0;
        let matched = false;

        for (const keyword of keywords) {
          if (titleLower.includes(keyword)) {
            score += 1.0;
            matched = true;
          } else if (contentLower.includes(keyword)) {
            score += 0.5;
            matched = true;
          }
        }

        if (matched) {
          results.push({
            id: memory.id!,
            type: memory.type,
            title: memory.title,
            preview: memory.content.substring(0, 200) + (memory.content.length > 200 ? '...' : ''),
            relevanceScore: Math.min(score / keywords.length, 1.0),
            createdAt: memory.createdAt!,
            metadata: memory.metadata
          });
        }
      }

      // Sort by relevance and limit
      results.sort((a, b) => b.relevanceScore - a.relevanceScore);
      const limitedResults = results.slice(0, limit);

      logger.info(
        { threadId, query, resultsFound: limitedResults.length },
        '[memory-search] Search completed'
      );

      return JSON.stringify({
        query,
        results: limitedResults,
        total_found: results.length
      });
    } catch (error) {
      logger.warn({ error, threadId }, '[memory-search] Search failed');
      return JSON.stringify({
        error: 'Search failed',
        results: [],
        total_found: 0
      });
    }
  },
  {
    name: 'memory_search',
    description: 'Search stored memories by query. Returns relevant memories with titles, previews, and relevance scores. Use to recall user preferences, feedback, project decisions, or external system references.',
    schema: z.object({
      query: z.string().describe('Search query (natural language)'),
      types: z.array(z.enum(['user', 'feedback', 'project', 'reference'])).optional().describe('Filter by memory type'),
      limit: z.number().default(5).describe('Maximum results to return'),
      hybrid: z.boolean().default(true).describe('Use hybrid search (semantic + keyword)')
    })
  }
);
```

- [ ] **Step 2: Register tool in index**

```typescript
// Add to src/tools/index.ts
export { memorySearchTool } from './memory-search';

// Add to tools array export
export const MEMORY_TOOLS = [memorySearchTool];
```

- [ ] **Step 3: Commit**

```bash
git add src/tools/memory-search.ts src/tools/index.ts
git commit -m "feat(memory): add memory_search tool for keyword search"
```

---

### Task 6: Create Memory Get Tool

**Files:**
- Create: `src/tools/memory-get.ts`

- [ ] **Step 1: Write the tool**

```typescript
// src/tools/memory-get.ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { MemoryRepository } from '../memory/repository';
import { createLogger } from '../utils/logger';

const logger = createLogger('memory-get-tool');

/**
 * Get a specific memory by ID
 */
export const memoryGetTool = tool(
  async ({ memory_id, include_related = false }, config) => {
    const threadId = config?.configurable?.thread_id as string;
    if (!threadId) {
      return JSON.stringify({ error: 'Missing thread_id' });
    }

    const repo = new MemoryRepository();

    try {
      const memory = await repo.getById(memory_id);

      if (!memory) {
        return JSON.stringify({
          error: 'Memory not found or access denied',
          memory_id
        });
      }

      // Verify thread ownership
      if (memory.threadId !== threadId) {
        return JSON.stringify({
          error: 'Access denied: memory belongs to different thread',
          memory_id
        });
      }

      const result: Record<string, unknown> = {
        id: memory.id,
        type: memory.type,
        title: memory.title,
        content: memory.content,
        metadata: memory.metadata,
        created_at: memory.createdAt?.toISOString(),
        access_count: memory.accessCount
      };

      // Include related memories if requested
      if (include_related) {
        const allMemories = await repo.getByThread(threadId, [memory.type]);
        const related = allMemories
          .filter(m => m.id !== memory.id)
          .slice(0, 3)
          .map(m => ({
            id: m.id,
            title: m.title,
            preview: m.content.substring(0, 100) + '...'
          }));

        result.related_memories = related;
      }

      logger.info({ threadId, memory_id }, '[memory-get] Retrieved memory');

      return JSON.stringify(result);
    } catch (error) {
      logger.warn({ error, memory_id }, '[memory-get] Failed to get memory');
      return JSON.stringify({
        error: 'Failed to retrieve memory',
        memory_id
      });
    }
  },
  {
    name: 'memory_get',
    description: 'Get the full content of a specific memory by ID. Use after memory_search to retrieve complete details. Optionally includes related memories of the same type.',
    schema: z.object({
      memory_id: z.string().describe('The UUID of the memory to retrieve'),
      include_related: z.boolean().default(false).describe('Also return related memories of the same type')
    })
  }
);
```

- [ ] **Step 2: Register tool in index**

```typescript
// Add to src/tools/index.ts
export { memoryGetTool } from './memory-get';

// Add to tools array export
export const MEMORY_TOOLS = [memorySearchTool, memoryGetTool];
```

- [ ] **Step 3: Commit**

```bash
git add src/tools/memory-get.ts src/tools/index.ts
git commit -m "feat(memory): add memory_get tool for retrieving specific memories"
```

---

### Task 7: Create Memory Forget Tool

**Files:**
- Create: `src/tools/memory-forget.ts`

- [ ] **Step 1: Write the tool**

```typescript
// src/tools/memory-forget.ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { MemoryRepository } from '../memory/repository';
import { createLogger } from '../utils/logger';

const logger = createLogger('memory-forget-tool');

/**
 * Soft delete (forget) a memory
 */
export const memoryForgetTool = tool(
  async ({ memory_id, reason }, config) => {
    const threadId = config?.configurable?.thread_id as string;
    if (!threadId) {
      return JSON.stringify({ error: 'Missing thread_id' });
    }

    const repo = new MemoryRepository();

    try {
      // First verify ownership
      const memory = await repo.getById(memory_id);

      if (!memory) {
        return JSON.stringify({
          error: 'Memory not found',
          memory_id
        });
      }

      if (memory.threadId !== threadId) {
        return JSON.stringify({
          error: 'Access denied: memory belongs to different thread',
          memory_id
        });
      }

      // Soft delete
      await repo.softDelete(memory_id);

      logger.info(
        { threadId, memory_id, reason },
        '[memory-forget] Memory forgotten'
      );

      return JSON.stringify({
        success: true,
        memory_id,
        message: 'Memory has been forgotten',
        reason: reason || 'No reason provided'
      });
    } catch (error) {
      logger.warn({ error, memory_id }, '[memory-forget] Failed to forget memory');
      return JSON.stringify({
        error: 'Failed to forget memory',
        memory_id
      });
    }
  },
  {
    name: 'memory_forget',
    description: 'Remove (forget) an incorrect or outdated memory. Use when the user says something is wrong or when a memory is no longer relevant. This is a soft delete - the memory is marked as inactive but not permanently removed.',
    schema: z.object({
      memory_id: z.string().describe('The UUID of the memory to forget'),
      reason: z.string().optional().describe('Why this memory is being forgotten (for audit trail)')
    })
  }
);
```

- [ ] **Step 2: Register tool in index**

```typescript
// Add to src/tools/index.ts
export { memoryForgetTool } from './memory-forget';

// Add to tools array export
export const MEMORY_TOOLS = [memorySearchTool, memoryGetTool, memoryForgetTool];
```

- [ ] **Step 3: Commit**

```bash
git add src/tools/memory-forget.ts src/tools/index.ts
git commit -m "feat(memory): add memory_forget tool for removing incorrect memories"
```

---

## Phase 2: Semantic Search

### Task 8: Create Embedding Service

**Files:**
- Create: `src/memory/embeddings.ts`

- [ ] **Step 1: Write tests**

```typescript
// src/memory/__tests__/embeddings.test.ts
import { describe, it, expect } from 'bun:test';
import { EmbeddingService } from '../embeddings';

describe('EmbeddingService', () => {
  const service = new EmbeddingService();

  it('should generate embedding for text', async () => {
    const text = 'User prefers TypeScript over JavaScript';
    const embedding = await service.generateEmbedding(text);

    expect(embedding).toBeInstanceOf(Array);
    expect(embedding.length).toBe(1536); // OpenAI text-embedding-3-small dimension
  });

  it('should generate embeddings for batch', async () => {
    const texts = ['First text', 'Second text', 'Third text'];
    const embeddings = await service.generateEmbeddingsBatch(texts);

    expect(embeddings.length).toBe(3);
    expect(embeddings[0].length).toBe(1536);
  });

  it('should handle empty text gracefully', async () => {
    const embedding = await service.generateEmbedding('');

    // Should return zero vector or handle gracefully
    expect(embedding).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/memory/__tests__/embeddings.test.ts
```
Expected: FAIL

- [ ] **Step 3: Write implementation**

```typescript
// src/memory/embeddings.ts
import { createLogger } from '../utils/logger';

const logger = createLogger('memory-embeddings');

const EMBEDDING_MODEL = process.env.MEMORY_EMBEDDING_MODEL || 'text-embedding-3-small';
const EMBEDDING_DIMENSION = 1536; // OpenAI text-embedding-3-small

/**
 * Service for generating embeddings via OpenAI API
 */
export class EmbeddingService {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || '';
    this.baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

    if (!this.apiKey) {
      logger.warn('[EmbeddingService] OPENAI_API_KEY not configured');
    }
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!text.trim()) {
      // Return zero vector for empty text
      return new Array(EMBEDDING_DIMENSION).fill(0);
    }

    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: text.trim()
        })
      });

      if (!response.ok) {
        const error = await response.text();
        logger.warn({ error }, '[EmbeddingService] Failed to generate embedding');
        throw new Error(`Embedding API error: ${error}`);
      }

      const data = await response.json();
      return data.data[0].embedding;
    } catch (error) {
      logger.warn({ error }, '[EmbeddingService] Embedding generation failed');
      // Return zero vector as fallback
      return new Array(EMBEDDING_DIMENSION).fill(0);
    }
  }

  /**
   * Generate embeddings for multiple texts (batch)
   */
  async generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Filter out empty texts
    const validTexts = texts.filter(t => t.trim().length > 0);
    const emptyIndices = new Set(
      texts.map((t, i) => (t.trim().length === 0 ? i : -1)).filter(i => i >= 0)
    );

    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: validTexts.map(t => t.trim())
        })
      });

      if (!response.ok) {
        const error = await response.text();
        logger.warn({ error }, '[EmbeddingService] Batch embedding failed');
        throw new Error(`Batch embedding API error: ${error}`);
      }

      const data = await response.json();
      const embeddings = data.data.map((d: { embedding: number[] }) => d.embedding);

      // Reinsert zero vectors for empty texts
      const result: number[][] = [];
      let validIdx = 0;
      for (let i = 0; i < texts.length; i++) {
        if (emptyIndices.has(i)) {
          result.push(new Array(EMBEDDING_DIMENSION).fill(0));
        } else {
          result.push(embeddings[validIdx++]);
        }
      }

      return result;
    } catch (error) {
      logger.warn({ error }, '[EmbeddingService] Batch embedding failed, falling back to individual requests');

      // Fallback: generate individually
      const result: number[][] = [];
      for (const text of texts) {
        result.push(await this.generateEmbedding(text));
      }
      return result;
    }
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Embeddings must have same dimension');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test src/memory/__tests__/embeddings.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/memory/embeddings.ts src/memory/__tests__/embeddings.test.ts
git commit -m "feat(memory): add EmbeddingService with OpenAI integration"
```

---

### Task 9: Create Search Service with Hybrid Search

**Files:**
- Create: `src/memory/search.ts`

- [ ] **Step 1: Write implementation**

```typescript
// src/memory/search.ts
import { createLogger } from '../utils/logger';
import { MemoryRepository } from './repository';
import { EmbeddingService } from './embeddings';
import type { MemoryType, MemorySearchOptions, MemorySearchResult } from './types';

const logger = createLogger('memory-search');

const SIMILARITY_THRESHOLD = parseFloat(process.env.MEMORY_SIMILARITY_THRESHOLD || '0.75');
const MAX_RESULTS = parseInt(process.env.MEMORY_MAX_RESULTS || '5', 10);

/**
 * Service for searching memories with semantic and keyword search
 */
export class SearchService {
  private repo: MemoryRepository;
  private embeddings: EmbeddingService;

  constructor() {
    this.repo = new MemoryRepository();
    this.embeddings = new EmbeddingService();
  }

  /**
   * Search memories using hybrid (semantic + keyword) search
   */
  async search(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    const { query, types, limit = MAX_RESULTS, hybrid = true, threadIds } = options;

    try {
      if (hybrid) {
        return await this.hybridSearch(query, types, limit, threadIds);
      } else {
        return await this.semanticSearch(query, types, limit, threadIds);
      }
    } catch (error) {
      logger.warn({ error, query }, '[SearchService] Search failed, falling back to keyword search');
      return await this.keywordSearch(query, types, limit, threadIds);
    }
  }

  /**
   * Hybrid search combining semantic and keyword results
   */
  private async hybridSearch(
    query: string,
    types: MemoryType[] | undefined,
    limit: number,
    threadIds: string[] | undefined
  ): Promise<MemorySearchResult[]> {
    // Run both searches in parallel
    const [semanticResults, keywordResults] = await Promise.all([
      this.semanticSearch(query, types, limit * 2, threadIds),
      this.keywordSearch(query, types, limit * 2, threadIds)
    ]);

    // Combine and deduplicate results
    const combined = new Map<string, MemorySearchResult>();

    // Add semantic results with weight
    for (const result of semanticResults) {
      combined.set(result.id, {
        ...result,
        relevanceScore: result.relevanceScore * 0.7 // Semantic weight
      });
    }

    // Add keyword results, boosting if already present
    for (const result of keywordResults) {
      const existing = combined.get(result.id);
      if (existing) {
        existing.relevanceScore = Math.max(
          existing.relevanceScore,
          result.relevanceScore * 0.3 + existing.relevanceScore
        );
      } else {
        combined.set(result.id, {
          ...result,
          relevanceScore: result.relevanceScore * 0.3 // Keyword weight
        });
      }
    }

    // Sort by combined score and limit
    return Array.from(combined.values())
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);
  }

  /**
   * Semantic search using embeddings and Supabase pgvector
   */
  private async semanticSearch(
    query: string,
    types: MemoryType[] | undefined,
    limit: number,
    threadIds: string[] | undefined
  ): Promise<MemorySearchResult[]> {
    try {
      // Generate query embedding
      const queryEmbedding = await this.embeddings.generateEmbedding(query);

      // For each thread, search memories
      const allResults: MemorySearchResult[] = [];
      const threadsToSearch = threadIds && threadIds.length > 0 ? threadIds : ['current']; // TODO: get actual thread IDs

      for (const threadId of threadsToSearch) {
        const memories = await this.repo.getByThread(threadId, types);

        for (const memory of memories) {
          if (!memory.embedding) continue;

          const similarity = this.embeddings.cosineSimilarity(queryEmbedding, memory.embedding);

          if (similarity >= SIMILARITY_THRESHOLD) {
            allResults.push({
              id: memory.id!,
              type: memory.type,
              title: memory.title,
              preview: memory.content.substring(0, 200) + '...',
              relevanceScore: similarity,
              createdAt: memory.createdAt!,
              metadata: memory.metadata
            });
          }
        }
      }

      return allResults
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, limit);
    } catch (error) {
      logger.warn({ error }, '[SearchService] Semantic search failed');
      return [];
    }
  }

  /**
   * Keyword-based full-text search
   */
  private async keywordSearch(
    query: string,
    types: MemoryType[] | undefined,
    limit: number,
    threadIds: string[] | undefined
  ): Promise<MemorySearchResult[]> {
    const threadsToSearch = threadIds && threadIds.length > 0 ? threadIds : ['current']; // TODO: get actual thread IDs

    const allResults: MemorySearchResult[] = [];
    const queryLower = query.toLowerCase();
    const keywords = queryLower.split(/\s+/).filter(w => w.length > 2);

    for (const threadId of threadsToSearch) {
      const memories = await this.repo.getByThread(threadId, types);

      for (const memory of memories) {
        const titleLower = memory.title.toLowerCase();
        const contentLower = memory.content.toLowerCase();

        let score = 0;
        let matched = false;

        for (const keyword of keywords) {
          if (titleLower.includes(keyword)) {
            score += 1.0;
            matched = true;
          } else if (contentLower.includes(keyword)) {
            score += 0.5;
            matched = true;
          }
        }

        if (matched) {
          allResults.push({
            id: memory.id!,
            type: memory.type,
            title: memory.title,
            preview: memory.content.substring(0, 200) + '...',
            relevanceScore: Math.min(score / keywords.length, 1.0),
            createdAt: memory.createdAt!,
            metadata: memory.metadata
          });
        }
      }
    }

    return allResults
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);
  }
}
```

- [ ] **Step 2: Update memory-search tool to use SearchService**

```typescript
// Update src/tools/memory-search.ts
import { SearchService } from '../memory/search';

export const memorySearchTool = tool(
  async ({ query, types, limit = 5, hybrid = true }, config) => {
    const threadId = config?.configurable?.thread_id as string;
    if (!threadId) {
      return JSON.stringify({ error: 'Missing thread_id' });
    }

    const searchService = new SearchService();

    try {
      const results = await searchService.search({
        query,
        types,
        limit,
        hybrid,
        threadIds: [threadId]
      });

      return JSON.stringify({
        query,
        results: results.map(r => ({
          ...r,
          created_at: r.createdAt.toISOString()
        })),
        total_found: results.length
      });
    } catch (error) {
      logger.warn({ error, threadId }, '[memory-search] Search failed');
      return JSON.stringify({
        error: 'Search failed',
        results: [],
        total_found: 0
      });
    }
  },
  // ... schema unchanged
);
```

- [ ] **Step 3: Commit**

```bash
git add src/memory/search.ts src/tools/memory-search.ts
git commit -m "feat(memory): add SearchService with hybrid semantic+keyword search"
```

---

## Phase 3: Consolidation

### Task 10: Create Consolidation Service

**Files:**
- Create: `src/memory/consolidation.ts`

- [ ] **Step 1: Write tests**

```typescript
// src/memory/__tests__/consolidation.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { ConsolidationService } from '../consolidation';
import { MemoryRepository } from '../repository';
import type { Memory } from '../types';

describe('ConsolidationService', () => {
  let service: ConsolidationService;
  let repo: MemoryRepository;
  const testThreadId = 'consolidation-test-' + Date.now();

  beforeEach(async () => {
    service = new ConsolidationService();
    repo = new MemoryRepository();

    // Create test memories
    await repo.save({
      threadId: testThreadId,
      type: 'user',
      title: 'Test preference 1',
      content: 'User prefers TypeScript',
      metadata: {}
    });

    await repo.save({
      threadId: testThreadId,
      type: 'user',
      title: 'Test preference 1', // Duplicate title
      content: 'User likes TypeScript',
      metadata: {}
    });
  });

  it('should detect duplicate memories', async () => {
    const duplicates = await service.findDuplicates(testThreadId);
    expect(duplicates.length).toBeGreaterThan(0);
  });

  it('should merge duplicate memories', async () => {
    const result = await service.consolidate(testThreadId);
    expect(result.merged).toBeGreaterThan(0);
  });

  it('should archive stale memories', async () => {
    // Create old memory
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 100);

    await repo.save({
      threadId: testThreadId,
      type: 'project',
      title: 'Old decision',
      content: 'Deprecated choice',
      metadata: {},
      createdAt: oldDate
    });

    const result = await service.consolidate(testThreadId);
    expect(result.archived).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/memory/__tests__/consolidation.test.ts
```
Expected: FAIL

- [ ] **Step 3: Write implementation**

```typescript
// src/memory/consolidation.ts
import { createLogger } from '../utils/logger';
import { MemoryRepository } from './repository';
import { EmbeddingService } from './embeddings';
import type { MemoryType, ConsolidationResult, Memory } from './types';

const logger = createLogger('memory-consolidation');

const STALE_DAYS = parseInt(process.env.MEMORY_CONSOLIDATION_STALE_DAYS || '90', 10);
const DUPLICATE_SIMILARITY_THRESHOLD = 0.9;

/**
 * Service for consolidating and cleaning up memories
 */
export class ConsolidationService {
  private repo: MemoryRepository;
  private embeddings: EmbeddingService;

  constructor() {
    this.repo = new MemoryRepository();
    this.embeddings = new EmbeddingService();
  }

  /**
   * Run consolidation for a thread
   */
  async consolidate(threadId: string): Promise<ConsolidationResult> {
    const result: ConsolidationResult = {
      processed: 0,
      merged: 0,
      archived: 0,
      errors: []
    };

    try {
      // Get all active memories for thread
      const allMemories = await this.repo.getByThread(threadId);
      result.processed = allMemories.length;

      // Find and merge duplicates
      const duplicates = await this.findDuplicates(threadId);
      for (const group of duplicates) {
        try {
          await this.mergeDuplicateGroup(group);
          result.merged += group.length - 1; // -1 because we keep one
        } catch (error) {
          result.errors.push(`Failed to merge duplicates: ${error}`);
        }
      }

      // Archive stale memories
      const stale = await this.findStaleMemories(threadId);
      for (const memory of stale) {
        try {
          await this.repo.softDelete(memory.id!);
          result.archived++;
        } catch (error) {
          result.errors.push(`Failed to archive stale memory: ${error}`);
        }
      }

      // Resolve time references
      await this.resolveTimeReferences(threadId);

      logger.info(
        { threadId, result },
        '[ConsolidationService] Consolidation complete'
      );

      return result;
    } catch (error) {
      logger.error({ error, threadId }, '[ConsolidationService] Consolidation failed');
      result.errors.push(`Consolidation failed: ${error}`);
      return result;
    }
  }

  /**
   * Find duplicate memories (same type, similar content)
   */
  async findDuplicates(threadId: string): Promise<Memory[][]> {
    const allMemories = await this.repo.getByThread(threadId);
    const groups: Memory[][] = [];
    const processed = new Set<string>();

    for (const memory of allMemories) {
      if (processed.has(memory.id!)) continue;

      const group = [memory];
      processed.add(memory.id!);

      // Find similar memories of same type
      for (const other of allMemories) {
        if (other.id === memory.id || processed.has(other.id!)) continue;
        if (other.type !== memory.type) continue;

        // Check title similarity
        const titleSimilarity = this.stringSimilarity(memory.title, other.title);

        // Check content similarity if both have embeddings
        let contentSimilarity = 0;
        if (memory.embedding && other.embedding) {
          contentSimilarity = this.embeddings.cosineSimilarity(memory.embedding, other.embedding);
        }

        if (titleSimilarity > DUPLICATE_SIMILARITY_THRESHOLD ||
            contentSimilarity > DUPLICATE_SIMILARITY_THRESHOLD) {
          group.push(other);
          processed.add(other.id!);
        }
      }

      if (group.length > 1) {
        groups.push(group);
      }
    }

    return groups;
  }

  /**
   * Merge a group of duplicate memories
   */
  async mergeDuplicateGroup(group: Memory[]): Promise<void> {
    if (group.length < 2) return;

    // Sort by created date, keep newest as primary
    group.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
    const [primary, ...duplicates] = group;

    // Combine metadata
    const combinedMetadata = {
      ...primary.metadata,
      consolidated_from: duplicates.map(d => d.id),
      consolidated_at: new Date().toISOString()
    };

    // Update primary with combined info
    await this.repo.update(primary.id!, {
      metadata: combinedMetadata
    });

    // Soft delete duplicates
    for (const duplicate of duplicates) {
      await this.repo.softDelete(duplicate.id!);
    }

    logger.info(
      { primaryId: primary.id, duplicateCount: duplicates.length },
      '[ConsolidationService] Merged duplicates'
    );
  }

  /**
   * Find stale memories (old and never accessed)
   */
  async findStaleMemories(threadId: string): Promise<Memory[]> {
    const allMemories = await this.repo.getByThread(threadId);
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - STALE_DAYS);

    return allMemories.filter(m => {
      if (!m.createdAt) return false;
      if (m.createdAt < staleDate && (m.accessCount || 0) === 0) {
        return true;
      }
      return false;
    });
  }

  /**
   * Resolve vague time references to exact dates
   */
  async resolveTimeReferences(threadId: string): Promise<void> {
    const allMemories = await this.repo.getByThread(threadId);
    const now = new Date();

    for (const memory of allMemories) {
      let updated = false;
      let content = memory.content;

      // Replace "yesterday" with actual date
      content = content.replace(
        /\byesterday\b/gi,
        new Date(now.getTime() - 86400000).toLocaleDateString()
      );

      // Replace "today" with actual date
      content = content.replace(
        /\btoday\b/gi,
        now.toLocaleDateString()
      );

      // Replace "last week" with date range
      content = content.replace(
        /\blast week\b/gi,
        `${new Date(now.getTime() - 7 * 86400000).toLocaleDateString()} - ${now.toLocaleDateString()}`
      );

      if (content !== memory.content) {
        await this.repo.update(memory.id!, { content });
        updated = true;
      }

      if (updated) {
        logger.debug({ memoryId: memory.id }, '[ConsolidationService] Resolved time references');
      }
    }
  }

  /**
   * Calculate string similarity (simple Jaccard-like)
   */
  private stringSimilarity(a: string, b: string): number {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();

    const aWords = new Set(aLower.split(/\s+/));
    const bWords = new Set(bLower.split(/\s+/));

    const intersection = new Set([...aWords].filter(x => bWords.has(x)));
    const union = new Set([...aWords, ...bWords]);

    return union.size === 0 ? 0 : intersection.size / union.size;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test src/memory/__tests__/consolidation.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/memory/consolidation.ts src/memory/__tests__/consolidation.test.ts
git commit -m "feat(memory): add ConsolidationService for duplicate detection and cleanup"
```

---

### Task 11: Create Background Daemon

**Files:**
- Create: `src/memory/daemon.ts`

- [ ] **Step 1: Write implementation**

```typescript
// src/memory/daemon.ts
import { createLogger } from '../utils/logger';
import { ConsolidationService } from './consolidation';

const logger = createLogger('memory-daemon');

const CONSOLIDATION_INTERVAL_HOURS = parseInt(
  process.env.MEMORY_CONSOLIDATION_INTERVAL_HOURS || '6',
  10
);
const MIN_SESSIONS_FOR_CONSOLIDATION = parseInt(
  process.env.MEMORY_CONSOLIDATION_MIN_SESSIONS || '5',
  10
);

interface ConsolidationState {
  lastRun: string;
  sessionsSinceLastRun: number;
  activeThreads: Set<string>;
}

/**
 * Background daemon for memory consolidation
 */
export class MemoryDaemon {
  private consolidationService: ConsolidationService;
  private state: ConsolidationState;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.consolidationService = new ConsolidationService();
    this.state = {
      lastRun: new Date(0).toISOString(),
      sessionsSinceLastRun: 0,
      activeThreads: new Set()
    };
  }

  /**
   * Start the daemon
   */
  start(): void {
    if (this.intervalId) {
      logger.warn('[MemoryDaemon] Already running');
      return;
    }

    const intervalMs = CONSOLIDATION_INTERVAL_HOURS * 60 * 60 * 1000;

    this.intervalId = setInterval(async () => {
      await this.runConsolidationCycle();
    }, intervalMs);

    logger.info(
      { intervalHours: CONSOLIDATION_INTERVAL_HOURS },
      '[MemoryDaemon] Started'
    );
  }

  /**
   * Stop the daemon
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('[MemoryDaemon] Stopped');
    }
  }

  /**
   * Register a new session/thread
   */
  registerSession(threadId: string): void {
    this.state.activeThreads.add(threadId);
    this.state.sessionsSinceLastRun++;

    logger.debug(
      { threadId, totalSessions: this.state.sessionsSinceLastRun },
      '[MemoryDaemon] Session registered'
    );
  }

  /**
   * Run a consolidation cycle
   */
  async runConsolidationCycle(): Promise<void> {
    const lastRun = new Date(this.state.lastRun);
    const hoursSinceLastRun = (Date.now() - lastRun.getTime()) / (1000 * 60 * 60);

    // Check trigger conditions
    if (hoursSinceLastRun < 24 && this.state.sessionsSinceLastRun < MIN_SESSIONS_FOR_CONSOLIDATION) {
      logger.debug(
        { hoursSinceLastRun, sessionsSinceLastRun: this.state.sessionsSinceLastRun },
        '[MemoryDaemon] Consolidation not triggered yet'
      );
      return;
    }

    logger.info(
      { hoursSinceLastRun, sessionsSinceLastRun: this.state.sessionsSinceLastRun },
      '[MemoryDaemon] Running consolidation cycle'
    );

    let totalProcessed = 0;
    let totalMerged = 0;
    let totalArchived = 0;

    // Consolidate each active thread
    for (const threadId of this.state.activeThreads) {
      try {
        const result = await this.consolidationService.consolidate(threadId);
        totalProcessed += result.processed;
        totalMerged += result.merged;
        totalArchived += result.archived;

        if (result.errors.length > 0) {
          logger.warn(
            { threadId, errors: result.errors },
            '[MemoryDaemon] Consolidation had errors'
          );
        }
      } catch (error) {
        logger.error(
          { threadId, error },
          '[MemoryDaemon] Consolidation failed for thread'
        );
      }
    }

    // Log consolidation to Supabase
    await this.logConsolidationRun(totalProcessed, totalMerged, totalArchived);

    // Reset state
    this.state.lastRun = new Date().toISOString();
    this.state.sessionsSinceLastRun = 0;

    logger.info(
      { totalProcessed, totalMerged, totalArchived },
      '[MemoryDaemon] Consolidation cycle complete'
    );
  }

  /**
   * Manually trigger consolidation
   */
  async triggerConsolidation(threadId?: string): Promise<void> {
    if (threadId) {
      const result = await this.consolidationService.consolidate(threadId);
      logger.info({ threadId, result }, '[MemoryDaemon] Manual consolidation complete');
    } else {
      await this.runConsolidationCycle();
    }
  }

  /**
   * Get daemon status
   */
  getStatus(): {
    isRunning: boolean;
    lastRun: string;
    sessionsSinceLastRun: number;
    activeThreadsCount: number;
  } {
    return {
      isRunning: this.intervalId !== null,
      lastRun: this.state.lastRun,
      sessionsSinceLastRun: this.state.sessionsSinceLastRun,
      activeThreadsCount: this.state.activeThreads.size
    };
  }

  /**
   * Log consolidation run to Supabase
   */
  private async logConsolidationRun(
    processed: number,
    merged: number,
    archived: number
  ): Promise<void> {
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

    try {
      await fetch(`${supabaseUrl}/rest/v1/agent_memory_consolidation_log`, {
        method: 'POST',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({
          memories_processed: processed,
          memories_merged: merged,
          memories_archived: archived
        })
      });
    } catch (error) {
      logger.warn({ error }, '[MemoryDaemon] Failed to log consolidation');
    }
  }
}

// Singleton instance
let daemonInstance: MemoryDaemon | null = null;

export function getMemoryDaemon(): MemoryDaemon {
  if (!daemonInstance) {
    daemonInstance = new MemoryDaemon();
  }
  return daemonInstance;
}
```

- [ ] **Step 2: Add consolidation endpoint to webapp**

```typescript
// Add to src/webapp.ts
import { getMemoryDaemon } from './memory/daemon';

// Add endpoints
app.post('/api/memory/consolidate', async (c) => {
  const { thread_id } = await c.req.json();
  const daemon = getMemoryDaemon();
  await daemon.triggerConsolidation(thread_id);
  return c.json({ success: true });
});

app.get('/api/memory/consolidation/status', (c) => {
  const daemon = getMemoryDaemon();
  return c.json(daemon.getStatus());
});
```

- [ ] **Step 3: Commit**

```bash
git add src/memory/daemon.ts src/webapp.ts
git commit -m "feat(memory): add background consolidation daemon"
```

---

## Phase 4: Integration

### Task 12: Integrate Memory into Blueprint

**Files:**
- Modify: `src/blueprints/retry-loop.ts`
- Modify: `src/nodes/deterministic/LinterNode.ts`

- [ ] **Step 1: Add memory pre-search to blueprint**

```typescript
// Add to src/blueprints/retry-loop.ts
import { SearchService } from '../memory/search';
import { memorySearchTool, memoryGetTool, memoryForgetTool } from '../tools';

// In the graph builder, add memory context injection
async function injectMemoryContext(state: typeof CodeagentState.State): Promise<void> {
  const threadId = state.configurable?.thread_id as string;
  if (!threadId) return;

  const searchService = new SearchService();
  const recentMemories = await searchService.search({
    query: state.input,
    limit: 3,
    types: ['user', 'feedback', 'project'],
    threadIds: [threadId]
  });

  if (recentMemories.length > 0) {
    const memoryContext = `
<relevant_memories>
${recentMemories.map(m => `- [${m.type}] ${m.title}: ${m.preview}`).join('\n')}
</relevant_memories>
`;
    // Inject into state for next turn
    state.memoryContext = memoryContext;
  }
}

// Add memory tools to the agent's tool list
export const MEMORY_TOOLS = [memorySearchTool, memoryGetTool, memoryForgetTool];
```

- [ ] **Step 2: Add memory extraction after turn**

```typescript
// Add to src/nodes/deterministic/LinterNode.ts
import { MemoryExtractor } from '../../memory/extractor';
import { MemoryRepository } from '../../memory/repository';
import { EmbeddingService } from '../../memory/embeddings';
import type { TurnResult } from '../../memory/types';

// After linter completes, extract and save memories
async function extractAndSaveMemories(state: typeof CodeagentState.State): Promise<void> {
  const threadId = state.configurable?.thread_id as string;
  if (!threadId) return;

  const extractor = new MemoryExtractor();
  const repo = new MemoryRepository();
  const embeddings = new EmbeddingService();

  const turnResult: TurnResult = {
    threadId,
    userText: state.input,
    input: state.input,
    agentReply: state.reply,
    agentError: state.error,
    plan: state.plan,
    fixAttempt: state.fixAttempt,
    deterministic: {
      formatResults: state.formatResults,
      linterResults: state.linterResults,
      testResults: state.testResults
    }
  };

  // Extract memories
  const extractedMemories = extractor.extractFromTurn(turnResult);

  if (extractedMemories.length > 0) {
    // Generate embeddings for all memories
    const texts = extractedMemories.map(m => `${m.title}\n\n${m.content}`);
    const embeddingVectors = await embeddings.generateEmbeddingsBatch(texts);

    // Save with embeddings
    const memoriesToSave = extractedMemories.map((m, i) => ({
      ...m,
      threadId,
      embedding: embeddingVectors[i]
    }));

    await repo.saveBatch(memoriesToSave);

    logger.info(
      { threadId, count: memoriesToSave.length },
      '[LinterNode] Saved memories'
    );
  }
}
```

- [ ] **Step 3: Register memory tools**

```typescript
// Add to src/tools/index.ts
export const ALL_TOOLS = [
  // ... existing tools
  ...MEMORY_TOOLS
];
```

- [ ] **Step 4: Commit**

```bash
git add src/blueprints/retry-loop.ts src/nodes/deterministic/LinterNode.ts src/tools/index.ts
git commit -m "feat(memory): integrate memory system into agent pipeline"
```

---

### Task 13: Add Environment Variables and Documentation

**Files:**
- Modify: `.env.example`
- Create: `docs/memory-system.md`

- [ ] **Step 1: Update .env.example**

```bash
# Add to .env.example
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
```

- [ ] **Step 2: Create documentation**

```markdown
<!-- docs/memory-system.md -->
# Memory System

The Bullhorse memory system provides persistent, cross-session memory for the agent.

## Features

- **Auto-capture**: Extracts memories from agent turns
- **Four memory types**: user, feedback, project, reference
- **Semantic search**: Find memories by meaning, not just keywords
- **Background consolidation**: Automatic cleanup of stale/duplicate memories

## Usage

### Agent Tools

The agent can use three tools to interact with memory:

- `memory_search`: Search memories by query
- `memory_get`: Retrieve full memory content
- `memory_forget`: Remove incorrect memories

### API Endpoints

```bash
# Trigger manual consolidation
POST /api/memory/consolidate
Body: { "thread_id": "..." }

# Check daemon status
GET /api/memory/consolidation/status
```

## Configuration

Set these environment variables:

```bash
MEMORY_ENABLED=true
MEMORY_EMBEDDING_MODEL=text-embedding-3-small
MEMORY_CONSOLIDATION_ENABLED=true
```

## Setup

1. Run the Supabase migration:
   ```bash
   psql $DATABASE_URL < migrations/20260411_memory_system.sql
   ```

2. Enable pgvector:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

3. Restart the agent.
```

- [ ] **Step 3: Commit**

```bash
git add .env.example docs/memory-system.md
git commit -m "docs(memory): add configuration and documentation"
```

---

### Task 14: Final Integration Testing

**Files:**
- Create: `src/memory/integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// src/memory/integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { MemoryExtractor } from './extractor';
import { MemoryRepository } from './repository';
import { EmbeddingService } from './embeddings';
import { SearchService } from './search';
import { ConsolidationService } from './consolidation';
import type { TurnResult } from './types';

describe('Memory System Integration', () => {
  const testThreadId = 'integration-test-' + Date.now();
  const repo = new MemoryRepository();
  const embeddings = new EmbeddingService();
  const extractor = new MemoryExtractor();
  const searchService = new SearchService();
  const consolidationService = new ConsolidationService();

  // Clean up after tests
  afterAll(async () => {
    const memories = await repo.getByThread(testThreadId);
    for (const memory of memories) {
      await repo.delete(memory.id!);
    }
  });

  it('should complete full flow: extract -> embed -> save -> search', async () => {
    // 1. Extract from turn
    const turn: TurnResult = {
      threadId: testThreadId,
      userText: 'I prefer using TypeScript strict mode',
      input: 'Add type checking',
      agentReply: 'I will enable strict mode in tsconfig.json'
    };

    const extracted = extractor.extractFromTurn(turn);
    expect(extracted.length).toBeGreaterThan(0);

    // 2. Generate embeddings
    const texts = extracted.map(m => `${m.title}\n\n${m.content}`);
    const vectors = await embeddings.generateEmbeddingsBatch(texts);
    expect(vectors.length).toBe(extracted.length);

    // 3. Save to database
    const toSave = extracted.map((m, i) => ({
      ...m,
      threadId: testThreadId,
      embedding: vectors[i]
    }));

    const saved = await repo.saveBatch(toSave);
    expect(saved.length).toBe(toSave.length);
    expect(saved[0].id).toBeDefined();

    // 4. Search and retrieve
    const results = await searchService.search({
      query: 'TypeScript preference',
      threadIds: [testThreadId],
      limit: 5
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].type).toBe('user');
  });

  it('should detect and merge duplicates', async () => {
    // Create two similar memories
    const text1 = 'User prefers TypeScript';
    const text2 = 'User likes TypeScript';

    await repo.save({
      threadId: testThreadId,
      type: 'user',
      title: 'TypeScript preference',
      content: text1,
      metadata: {}
    });

    await repo.save({
      threadId: testThreadId,
      type: 'user',
      title: 'TypeScript preference',
      content: text2,
      metadata: {}
    });

    // Run consolidation
    const result = await consolidationService.consolidate(testThreadId);

    expect(result.merged).toBeGreaterThan(0);

    // Verify only one active memory remains
    const memories = await repo.getByThread(testThreadId, ['user']);
    const typeScriptMemories = memories.filter(m => m.title.includes('TypeScript'));
    expect(typeScriptMemories.filter(m => m.isActive).length).toBeLessThan(2);
  });

  it('should handle semantic search with embeddings', async () => {
    // Create memory with embedding
    const memory = await repo.save({
      threadId: testThreadId,
      type: 'project',
      title: 'Redis configuration',
      content: 'Redis is running on port 6380 due to conflict',
      metadata: {},
      embedding: await embeddings.generateEmbedding('Redis port 6380 configuration')
    });

    // Search with different wording
    const results = await searchService.search({
      query: 'database port settings',
      threadIds: [testThreadId],
      limit: 5
    });

    expect(results.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run integration test**

```bash
bun test src/memory/integration.test.ts
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/memory/integration.test.ts
git commit -m "test(memory): add integration test for full memory flow"
```

---

### Task 15: Start Memory Daemon on Server Startup

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add daemon startup**

```typescript
// Add to src/index.ts
import { getMemoryDaemon } from './memory/daemon';

// After server initialization
if (process.env.MEMORY_CONSOLIDATION_ENABLED === 'true') {
  const daemon = getMemoryDaemon();
  daemon.start();
  logger.info('[Server] Memory consolidation daemon started');
}
```

- [ ] **Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat(memory): auto-start consolidation daemon on server startup"
```

---

## Completion Checklist

- [ ] All tests passing
- [ ] Supabase migration applied
- [ ] Environment variables configured
- [ ] Memory tools registered and available to agent
- [ ] Consolidation daemon running
- [ ] Documentation complete
- [ ] Integration tests passing
