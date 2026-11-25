-- Run once in Supabase SQL Editor as project administrator (after supabase/schema.sql).
-- Creates private owner-only storage for RPA! Workbench plus revocable SHA-256 hashed
-- agent tokens for authorized MCP & ChatGPT/Gemini agent access.
-- Zero service_role key is ever needed on Vercel.

create table if not exists public.workbench_snapshots (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  ideas jsonb not null default '[]'::jsonb,
  projects jsonb not null default '[]'::jsonb,
  digests jsonb not null default '[]'::jsonb,
  custom_categories jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.workbench_agent_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 80),
  token_prefix text not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  scopes text[] not null default array['read:ideas', 'read:projects', 'read:graph'],
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);

create index if not exists idx_workbench_agent_tokens_owner
  on public.workbench_agent_tokens(owner_id);

alter table public.workbench_snapshots enable row level security;
alter table public.workbench_agent_tokens enable row level security;

revoke all on public.workbench_snapshots, public.workbench_agent_tokens from anon, authenticated;
grant select, insert, update, delete on public.workbench_snapshots to authenticated;
grant select, insert, update, delete on public.workbench_agent_tokens to authenticated;

-- Strict owner-only RLS policies (must be both auth.uid() AND in public.course_owners)
drop policy if exists workbench_snapshots_owner_all on public.workbench_snapshots;
create policy workbench_snapshots_owner_all
  on public.workbench_snapshots
  for all
  to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (select 1 from public.course_owners where user_id = (select auth.uid()))
  )
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.course_owners where user_id = (select auth.uid()))
  );

drop policy if exists workbench_agent_tokens_owner_all on public.workbench_agent_tokens;
create policy workbench_agent_tokens_owner_all
  on public.workbench_agent_tokens
  for all
  to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (select 1 from public.course_owners where user_id = (select auth.uid()))
  )
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.course_owners where user_id = (select auth.uid()))
  );

-- Narrow SECURITY DEFINER RPC for authorized external agents (MCP / ChatGPT / Gemini).
-- Never exposes digests, email credentials, or other token hashes.
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

  select *
    into v_token
    from public.workbench_agent_tokens
   where token_hash = p_token_hash
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Invalid agent token');
  end if;

  if v_token.revoked_at is not null then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Token has been revoked');
  end if;

  if v_token.expires_at is not null and v_token.expires_at <= now() then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Token has expired');
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

  select *
    into v_snap
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
    'custom_categories', coalesce(v_snap.custom_categories, '[]'::jsonb),
    'updated_at', v_snap.updated_at
  );
end;
$$;

-- Narrow SECURITY DEFINER RPC for agents with explicit 'write:ideas' scope.
create or replace function public.agent_append_idea(
  p_token_hash text,
  p_idea jsonb,
  p_new_category text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token public.workbench_agent_tokens%rowtype;
  v_existing_cats jsonb;
  v_next_cats jsonb;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Invalid token format');
  end if;

  if p_idea is null or jsonb_typeof(p_idea) <> 'object' then
    return jsonb_build_object('ok', false, 'status', 400, 'error', 'Invalid idea payload');
  end if;

  select *
    into v_token
    from public.workbench_agent_tokens
   where token_hash = p_token_hash
   limit 1;

  if not found or v_token.revoked_at is not null or (v_token.expires_at is not null and v_token.expires_at <= now()) then
    return jsonb_build_object('ok', false, 'status', 401, 'error', 'Unauthorized or expired token');
  end if;

  if not exists (select 1 from public.course_owners where user_id = v_token.owner_id) then
    return jsonb_build_object('ok', false, 'status', 403, 'error', 'Token owner is not authorized');
  end if;

  if not ('write:ideas' = any(v_token.scopes)) then
    return jsonb_build_object('ok', false, 'status', 403, 'error', 'Missing required scope: write:ideas');
  end if;

  update public.workbench_agent_tokens
     set last_used_at = now()
   where id = v_token.id;

  insert into public.workbench_snapshots (owner_id, ideas, projects, digests, custom_categories, updated_at)
  values (
    v_token.owner_id,
    jsonb_build_array(p_idea),
    '[]'::jsonb,
    '[]'::jsonb,
    case when p_new_category is not null and length(trim(p_new_category)) > 0
      then jsonb_build_array(trim(p_new_category))
      else '[]'::jsonb
    end,
    now()
  )
  on conflict (owner_id) do update
  set ideas = jsonb_build_array(p_idea) || coalesce(public.workbench_snapshots.ideas, '[]'::jsonb),
      custom_categories = case
        when p_new_category is not null
         and length(trim(p_new_category)) > 0
         and not (coalesce(public.workbench_snapshots.custom_categories, '[]'::jsonb) @> to_jsonb(trim(p_new_category)))
        then coalesce(public.workbench_snapshots.custom_categories, '[]'::jsonb) || jsonb_build_array(trim(p_new_category))
        else coalesce(public.workbench_snapshots.custom_categories, '[]'::jsonb)
      end,
      updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'status', 201,
    'id', p_idea->>'id',
    'category', p_idea->>'domain'
  );
end;
$$;

revoke all on function public.agent_get_workbench(text, text) from public;
revoke all on function public.agent_append_idea(text, jsonb, text) from public;
grant execute on function public.agent_get_workbench(text, text) to anon, authenticated;
grant execute on function public.agent_append_idea(text, jsonb, text) to anon, authenticated;
