-- Optional 1-time migration for cloud + external agent (ChatGPT/Gemini/MCP) To-Do & Calendar sync.
-- Safe to run anytime in Supabase SQL Editor. Zero service_role key needed on Vercel.

alter table public.workbench_snapshots
  add column if not exists todos jsonb not null default '[]'::jsonb;

-- Update agent_get_workbench to also return todos
create or replace function public.agent_get_workbench(
  p_token_hash text,
  p_required_scope text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token public.workbench_agent_tokens%rowtype;
  v_snap public.workbench_snapshots%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Invalid token format');
  end if;

  select * into v_token
    from public.workbench_agent_tokens
   where token_hash = p_token_hash
   limit 1;

  if not found or v_token.revoked_at is not null or (v_token.expires_at is not null and v_token.expires_at <= now()) then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Unauthorized or expired token');
  end if;

  if not exists (select 1 from public.course_owners where user_id = v_token.owner_id) then
    return jsonb_build_object('ok', false, 'status', 403, 'error', 'Token owner is not authorized');
  end if;

  if p_required_scope is not null and not (p_required_scope = any(v_token.scopes)) then
    return jsonb_build_object('ok', false, 'status', 403, 'error', 'Missing required scope: ' || p_required_scope);
  end if;

  update public.workbench_agent_tokens
     set last_used_at = now()
   where id = v_token.id;

  select * into v_snap
    from public.workbench_snapshots
   where owner_id = v_token.owner_id
   limit 1;

  return jsonb_build_object(
    'ok', true,
    'status', 200,
    'label', v_token.label,
    'scopes', to_jsonb(v_token.scopes),
    'ideas', coalesce(v_snap.ideas, '[]'::jsonb),
    'projects', coalesce(v_snap.projects, '[]'::jsonb),
    'todos', coalesce(v_snap.todos, '[]'::jsonb),
    'custom_categories', coalesce(v_snap.custom_categories, '[]'::jsonb),
    'updated_at', v_snap.updated_at
  );
end;
$$;

-- Narrow SECURITY DEFINER RPC for Gemini/ChatGPT/MCP agents to add, edit, suggest, or rank To-Dos
create or replace function public.agent_save_todos(
  p_token_hash text,
  p_todos jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth jsonb;
  v_owner uuid;
begin
  v_auth := public._verify_workbench_agent_token(p_token_hash, 'write:ideas');
  if coalesce((v_auth->>'ok')::boolean, false) = false then
    return v_auth;
  end if;

  if p_todos is null or jsonb_typeof(p_todos) <> 'array' then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'todos must be a JSON array');
  end if;

  v_owner := (v_auth->>'owner_id')::uuid;

  insert into public.workbench_snapshots (owner_id, ideas, projects, digests, todos, custom_categories, updated_at)
  values (v_owner, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, p_todos, '[]'::jsonb, now())
  on conflict (owner_id) do update
    set todos = p_todos,
        updated_at = now();

  return jsonb_build_object('ok', true, 'status', 200, 'count', jsonb_array_length(p_todos));
end;
$$;

revoke all on function public.agent_save_todos(text, jsonb) from public;
grant execute on function public.agent_save_todos(text, jsonb) to anon, authenticated;
