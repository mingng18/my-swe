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
