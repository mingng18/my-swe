# Memory System

The Bullhorse Memory System provides persistent context for the agent across sessions, enabling it to remember user preferences, project context, and feedback over time.

## Overview

The memory system is inspired by Claude Code's Auto Memory feature and provides:

- **Semantic Search**: Finds relevant memories using embedding-based similarity
- **Automatic Extraction**: Extracts memories from agent turns without manual prompting
- **Smart Consolidation**: Merges duplicates and archives stale memories periodically
- **Type-Based Organization**: Categorizes memories as user preferences, feedback, project context, or references

## Architecture

### Core Components

1. **Memory Repository** (`src/memory/repository.ts`)
   - Supabase-backed storage for memories
   - CRUD operations with soft delete support
   - Thread-based isolation for multi-tenancy

2. **Memory Extractor** (`src/memory/extractor.ts`)
   - Pattern-based extraction from agent turns
   - Identifies user preferences, expertise, feedback, and project context
   - Extracts from user input, agent replies, errors, and deterministic results

3. **Embedding Service** (`src/memory/embeddings.ts`)
   - OpenAI text-embedding-3-small integration
   - Cosine similarity calculation
   - Efficient embedding generation and caching

4. **Search Service** (`src/memory/search.ts`)
   - Hybrid search combining semantic and keyword matching
   - Configurable similarity thresholds and result limits
   - Type-based filtering

5. **Consolidation Service** (`src/memory/consolidation.ts`)
   - Duplicate detection using semantic similarity
   - Automatic merging of similar memories
   - Archival of stale memories

6. **Memory Daemon** (`src/memory/daemon.ts`)
   - Background consolidation scheduler
   - Session registration and tracking
   - Periodic cleanup and optimization

## Memory Types

### User Memories
- **Preferences**: "I prefer TypeScript over JavaScript"
- **Expertise**: "I am a frontend developer"
- **Context**: Information about the user's background and preferences

### Feedback Memories
- **Positive**: "Great, that's exactly what I needed"
- **Negative**: "No, that's not what I asked for"
- **Corrections**: User corrections and refinements

### Project Memories
- **Architecture**: Design patterns and architectural decisions
- **Tech Stack**: Frameworks and libraries used
- **Errors**: Common errors and their solutions
- **Linting**: Linter errors and fixes
- **Testing**: Test failures and patterns

### Reference Memories
- **External Systems**: GitHub, Linear, Jira, Slack, etc.
- **Documentation**: Links to relevant docs
- **Resources**: External references and dependencies

## Setup

### 1. Database Setup

Run the Supabase migration to create the memories table:

```sql
-- Run this in your Supabase SQL editor
CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('user', 'feedback', 'project', 'reference')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  source_run_id TEXT,
  is_active BOOLEAN DEFAULT true,
  access_count INTEGER DEFAULT 0,
  last_accessed_at TIMESTAMPTZ,
  embedding VECTOR(1536)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_memories_thread_id ON memories(thread_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_is_active ON memories(is_active);

-- Enable Row Level Security
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;

-- Create policy for service role access
CREATE POLICY "Service role has full access" ON memories
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
```

### 2. Environment Configuration

Add these variables to your `.env` file:

```bash
# Enable memory system
MEMORY_ENABLED=true

# Embedding model (requires OPENAI_API_KEY)
MEMORY_EMBEDDING_MODEL=text-embedding-3-small

# Search configuration
MEMORY_SIMILARITY_THRESHOLD=0.75
MEMORY_MAX_RESULTS=5

# Consolidation settings
MEMORY_CONSOLIDATION_ENABLED=true
MEMORY_CONSOLIDATION_INTERVAL_HOURS=6
MEMORY_CONSOLIDATION_MIN_SESSIONS=5
MEMORY_CONSOLIDATION_STALE_DAYS=90

# Supabase configuration (if not already set)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 3. Initialize Memory Services

The memory system initializes automatically on server startup if `MEMORY_ENABLED=true`.

## Usage

### Automatic Memory Flow

The memory system integrates seamlessly into the agent pipeline:

1. **Pre-Search**: Before each agent turn, relevant memories are retrieved and injected as context
2. **Post-Extraction**: After each turn, memories are extracted from the conversation
3. **Periodic Consolidation**: Background daemon merges duplicates and archives stale memories

### Manual Memory Tools

The agent also has access to manual memory tools:

#### `memory_search`
Search for memories by query text.

```typescript
// Agent can call:
memory_search({
  query: "TypeScript preferences",
  types: ["user"],
  limit: 5
})
```

#### `memory_get`
Retrieve a specific memory by ID.

```typescript
memory_get({
  id: "uuid-here"
})
```

#### `memory_forget`
Delete or archive a memory.

```typescript
memory_forget({
  id: "uuid-here",
  permanent: false  // soft delete by default
})
```

## API Endpoints

### Health Check
```http
GET /health
```

Returns memory system status.

### Memory Statistics
```http
GET /memory/stats/:threadId
```

Returns memory statistics for a thread:
- Total memories
- Memories by type
- Most recent memories
- Active vs archived count

### Trigger Consolidation
```http
POST /memory/consolidate
```

Manually trigger consolidation for a thread.

```json
{
  "threadId": "thread-uuid"
}
```

### Daemon Status
```http
GET /memory/daemon/status
```

Returns daemon status:
- Running state
- Last consolidation time
- Next consolidation time
- Registered sessions
- Total consolidations run

## Configuration

### Similarity Threshold

Controls how strict memory matching is:

- **0.9+**: Very strict, only near-duplicate matches
- **0.7-0.9**: Balanced (default)
- **0.5-0.7**: Permissive, more results

### Maximum Results

Limits how many memories are injected per turn:

- **3-5**: Focused context (default)
- **10+**: Comprehensive context (may be noisy)

### Consolidation Settings

- **Interval**: How often to run consolidation (default: 6 hours)
- **Min Sessions**: Minimum active sessions before consolidation (default: 5)
- **Stale Days**: Days before memories are considered stale (default: 90)

## Best Practices

### 1. Memory Quality

- Be specific in your feedback to help the agent learn
- Use consistent terminology for project concepts
- Provide context when correcting the agent

### 2. Privacy

- Memories are isolated per thread ID
- Use thread IDs consistently for related conversations
- Review and archive sensitive memories regularly

### 3. Performance

- Keep `MEMORY_MAX_RESULTS` moderate (3-5) to avoid context bloat
- Run consolidation during off-peak hours
- Monitor embedding API costs (OpenAI charges per token)

### 4. Testing

- Test memory extraction with various conversation patterns
- Verify semantic search returns relevant results
- Check consolidation doesn't merge distinct memories

## Troubleshooting

### Memories Not Being Saved

1. Check `MEMORY_ENABLED=true`
2. Verify Supabase credentials are correct
3. Check logs for extraction errors

### Search Returns No Results

1. Lower `MEMORY_SIMILARITY_THRESHOLD`
2. Increase `MEMORY_MAX_RESULTS`
3. Verify embeddings are being generated

### Consolidation Not Running

1. Check `MEMORY_CONSOLIDATION_ENABLED=true`
2. Verify daemon is running: `GET /memory/daemon/status`
3. Check minimum sessions threshold

### Embedding API Errors

1. Verify `OPENAI_API_KEY` is set
2. Check API quota and rate limits
3. Consider using a different embedding model

## Examples

### Example 1: User Preferences

**User**: "I prefer using TypeScript strict mode and never use any types"

**Memory Extracted**:
```json
{
  "type": "user",
  "title": "[preference] I prefer using TypeScript strict mode...",
  "content": "I prefer using TypeScript strict mode and never use any types",
  "metadata": { "pattern": "preference" }
}
```

**Future Context**: Agent will always use strict mode and avoid `any` types.

### Example 2: Project Context

**Agent**: "I'll implement this using React with TypeScript and the Context API for state management"

**Memory Extracted**:
```json
{
  "type": "project",
  "title": "[tech_stack] I'll implement this using React...",
  "content": "I'll implement this using React with TypeScript and the Context API for state management",
  "metadata": { "category": "tech_stack" }
}
```

**Future Context**: Agent knows the project uses React + TypeScript + Context API.

### Example 3: Feedback

**User**: "No, that's wrong. We use Redux, not Context API"

**Memory Extracted**:
```json
{
  "type": "feedback",
  "title": "[correction] No, that's wrong. We use Redux...",
  "content": "No, that's wrong. We use Redux, not Context API",
  "metadata": { "sentiment": "negative" }
}
```

**Future Context**: Agent will use Redux instead of Context API.

## Performance Considerations

### Embedding Costs

OpenAI's `text-embedding-3-small` costs ~$0.00002 per 1K tokens.

**Estimated costs**:
- 100 memories: ~$0.002
- 1,000 memories: ~$0.02
- 10,000 memories: ~$0.20

### Database Storage

Each memory with embedding (~3KB):
- 1,000 memories: ~3MB
- 10,000 memories: ~30MB
- 100,000 memories: ~300MB

### Search Latency

Typical search times:
- 10 memories: ~50ms
- 100 memories: ~100ms
- 1,000 memories: ~200ms

## Future Enhancements

- [ ] Multi-thread memory sharing
- [ ] Memory export/import
- [ ] Memory analytics dashboard
- [ ] Custom memory types
- [ ] Memory graph visualization
- [ ] Collaborative memory editing
- [ ] Memory versioning
- [ ] Advanced consolidation strategies

## References

- [Claude Code Auto Memory](https://code.anthropic.com/docs/memory)
- [OpenAI Embeddings](https://platform.openai.com/docs/guides/embeddings)
- [Supabase Vector Columns](https://supabase.com/docs/guides/ai/vector-columns)
- [Cosine Similarity](https://en.wikipedia.org/wiki/Cosine_similarity)
