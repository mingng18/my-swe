-- Enable pgvector extension (should already be enabled by previous migration, but safe to repeat)
create extension if not exists vector;

-- Main memory table
create table if not exists public.agent_memory (
  id uuid primary key default gen_random_uuid(),
  thread_id text not null,
  memory_type text not null check (memory_type in ('user', 'feedback', 'project', 'reference')),
  title text not null,
  content text not null,
  embedding vector(1536),
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  expires_at timestamptz,
  source_run_id uuid references public.agent_run (id) on delete set null,
  is_active boolean default true,
  access_count integer default 0,
  last_accessed_at timestamptz
);

-- Index for semantic search (IVFFlat for approximate nearest neighbor)
create index if not exists agent_memory_embedding_idx
  on public.agent_memory
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Index for lookup by thread/type/active
create index if not exists agent_memory_thread_idx
  on public.agent_memory(thread_id, memory_type, is_active);

-- Index for active memories with expiration
create index if not exists agent_memory_expires_at_idx
  on public.agent_memory(expires_at)
  where is_active = true;

-- Index for full-text search on title and content
create index if not exists agent_memory_content_idx
  on public.agent_memory
  using gin(to_tsvector('english', title || ' ' || content));

-- Consolidation log table
create table if not exists public.agent_memory_consolidation_log (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz default now(),
  finished_at timestamptz,
  memories_processed integer default 0,
  memories_merged integer default 0,
  memories_archived integer default 0,
  errors text
);

-- Function to update updated_at timestamp
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Trigger to auto-update updated_at
create trigger update_agent_memory_updated_at
  before update on public.agent_memory
  for each row
  execute function public.update_updated_at_column();

-- Helper function: cosine similarity search
create or replace function public.search_memories(
  p_thread_id text,
  p_query_embedding vector(1536),
  p_memory_types text[] default null,
  p_limit integer default 10,
  p_threshold float default 0.75
)
returns table (
  id uuid,
  thread_id text,
  memory_type text,
  title text,
  content text,
  metadata jsonb,
  created_at timestamptz,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    am.id,
    am.thread_id,
    am.memory_type,
    am.title,
    am.content,
    am.metadata,
    am.created_at,
    1 - (am.embedding <=> p_query_embedding) as similarity
  from public.agent_memory am
  where
    am.thread_id = p_thread_id
    and am.is_active = true
    and (p_memory_types is null or am.memory_type = any(p_memory_types))
    and am.embedding is not null
    and (1 - (am.embedding <=> p_query_embedding)) >= p_threshold
  order by am.embedding <=> p_query_embedding
  limit p_limit;
end;
$$;

-- Helper function: full-text search
create or replace function public.search_memories_fts(
  p_thread_id text,
  p_query text,
  p_memory_types text[] default null,
  p_limit integer default 10
)
returns table (
  id uuid,
  thread_id text,
  memory_type text,
  title text,
  content text,
  metadata jsonb,
  created_at timestamptz,
  rank float
)
language plpgsql
as $$
begin
  return query
  select
    am.id,
    am.thread_id,
    am.memory_type,
    am.title,
    am.content,
    am.metadata,
    am.created_at,
    ts_rank(to_tsvector('english', am.title || ' ' || am.content), plainto_tsquery('english', p_query)) as rank
  from public.agent_memory am
  where
    am.thread_id = p_thread_id
    and am.is_active = true
    and (p_memory_types is null or am.memory_type = any(p_memory_types))
    and to_tsvector('english', am.title || ' ' || am.content) @@ plainto_tsquery('english', p_query)
  order by rank desc
  limit p_limit;
end;
$$;
