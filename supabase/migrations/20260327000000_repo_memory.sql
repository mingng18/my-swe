create extension if not exists vector;

create table if not exists public.repo (
  id uuid primary key,
  owner text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (owner, name)
);

create table if not exists public.thread_repo_context (
  thread_id text primary key,
  repo_id uuid references public.repo (id) on delete set null,
  workspace_dir text not null,
  profile text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_run (
  id uuid primary key,
  thread_id text not null,
  repo_id uuid references public.repo (id) on delete set null,
  agent_version text not null default 'dev',
  input_hash text not null,
  reply_hash text not null,
  status text not null,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now(),
  unique (thread_id, input_hash)
);

create index if not exists agent_run_thread_id_idx on public.agent_run (thread_id);
create index if not exists agent_run_repo_id_idx on public.agent_run (repo_id);

create table if not exists public.repo_memory_facts (
  id uuid primary key,
  repo_id uuid not null references public.repo (id) on delete cascade,
  fact_type text not null,
  fact_key text not null,
  value_json jsonb not null,
  source_run_id uuid references public.agent_run (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists repo_memory_facts_repo_id_idx on public.repo_memory_facts (repo_id);
create index if not exists repo_memory_facts_type_key_idx on public.repo_memory_facts (repo_id, fact_type, fact_key);

create table if not exists public.repo_memory_decisions (
  id uuid primary key,
  repo_id uuid not null references public.repo (id) on delete cascade,
  decision_key text not null,
  summary text not null,
  rationale text,
  status text not null default 'active',
  source_run_id uuid references public.agent_run (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (repo_id, decision_key)
);

create index if not exists repo_memory_decisions_repo_id_idx on public.repo_memory_decisions (repo_id);

create table if not exists public.github_credential_refs (
  id uuid primary key,
  thread_id text not null,
  provider text not null default 'github',
  encrypted_secret text,
  secret_ref text,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

create index if not exists github_credential_refs_thread_id_idx on public.github_credential_refs (thread_id);

create table if not exists public.sandbox_lease (
  id uuid primary key,
  thread_id text not null,
  repo_id uuid references public.repo (id) on delete set null,
  daytona_sandbox_id text not null,
  profile text not null,
  lease_status text not null,
  acquired_at timestamptz not null default now(),
  released_at timestamptz
);

create unique index if not exists sandbox_lease_daytona_id_uniq on public.sandbox_lease (daytona_sandbox_id);
create index if not exists sandbox_lease_thread_id_idx on public.sandbox_lease (thread_id);
create index if not exists sandbox_lease_repo_id_idx on public.sandbox_lease (repo_id);

create table if not exists public.repo_memory_chunks (
  id uuid primary key,
  repo_id uuid not null references public.repo (id) on delete cascade,
  chunk_type text not null,
  content_text text not null,
  content_hash text not null,
  embedding vector(1536),
  source_run_id uuid references public.agent_run (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists repo_memory_chunks_repo_id_idx on public.repo_memory_chunks (repo_id);

