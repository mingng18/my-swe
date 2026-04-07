create or replace function public.record_agent_turn(
  p_repo_id uuid,
  p_owner text,
  p_name text,
  p_thread_id text,
  p_workspace_dir text,
  p_profile text,
  p_agent_run_id uuid,
  p_input_hash text,
  p_reply_hash text,
  p_status text,
  p_error text,
  p_started_at timestamptz,
  p_finished_at timestamptz,
  p_facts jsonb,
  p_chunks jsonb
) returns uuid as $$
declare
  v_repo_id uuid;
  v_agent_run_id uuid;
begin
  -- 1) Repo upsert
  insert into public.repo (id, owner, name, created_at)
  values (p_repo_id, p_owner, p_name, p_started_at)
  on conflict (owner, name) do update set owner = excluded.owner
  returning id into v_repo_id;

  -- 2) Thread repo context upsert
  insert into public.thread_repo_context (thread_id, repo_id, workspace_dir, profile, updated_at)
  values (p_thread_id, v_repo_id, p_workspace_dir, p_profile, p_started_at)
  on conflict (thread_id) do update set
    repo_id = excluded.repo_id,
    workspace_dir = excluded.workspace_dir,
    profile = excluded.profile,
    updated_at = excluded.updated_at;

  -- 3) Agent run upsert
  insert into public.agent_run (id, thread_id, repo_id, agent_version, input_hash, reply_hash, status, error, started_at, finished_at)
  values (p_agent_run_id, p_thread_id, v_repo_id, 'dev', p_input_hash, p_reply_hash, p_status, p_error, p_started_at, p_finished_at)
  on conflict (thread_id, input_hash) do update set
    reply_hash = excluded.reply_hash,
    status = excluded.status,
    error = excluded.error,
    finished_at = excluded.finished_at
  returning id into v_agent_run_id;

  -- 4) Facts insert
  if p_facts is not null and jsonb_typeof(p_facts) = 'array' then
    insert into public.repo_memory_facts (id, repo_id, fact_type, fact_key, value_json, source_run_id, created_at)
    select
      (elem->>'id')::uuid,
      v_repo_id,
      elem->>'fact_type',
      elem->>'fact_key',
      elem->'value_json',
      v_agent_run_id,
      (elem->>'created_at')::timestamptz
    from jsonb_array_elements(p_facts) as elem;
  end if;

  -- 5) Chunks insert (optional)
  if p_chunks is not null and jsonb_typeof(p_chunks) = 'array' then
    insert into public.repo_memory_chunks (id, repo_id, chunk_type, content_text, content_hash, source_run_id, created_at)
    select
      (elem->>'id')::uuid,
      v_repo_id,
      elem->>'chunk_type',
      elem->>'content_text',
      elem->>'content_hash',
      v_agent_run_id,
      (elem->>'created_at')::timestamptz
    from jsonb_array_elements(p_chunks) as elem;
  end if;

  return v_agent_run_id;
end;
$$ language plpgsql security definer;
