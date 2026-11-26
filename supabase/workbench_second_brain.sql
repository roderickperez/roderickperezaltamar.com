-- Run once in Supabase SQL Editor as project administrator (after supabase/workbench.sql).
-- Adds Second-Brain memory tables (Confirmed Rules & Profile, Living Project Wiki Pages,
-- and Typed Cross-Agent Handoffs) with strict owner-only RLS and narrow SECURITY DEFINER
-- RPCs for SHA-256 hashed agent tokens. Zero service_role key is ever needed on Vercel.

-- 1. Portable Profile & Confirmed Routing Rules (from open-second-brain + ai-memory + gbrain)
create table if not exists public.workbench_memory_rules (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'routing_rule' check (kind in ('profile', 'routing_rule', 'preference')),
  title text not null,
  rule_text text not null,
  pattern text,
  target_domain text,
  confidence numeric(4, 3) not null default 0.75,
  evidence_count integer not null default 1,
  applied_count integer not null default 0,
  source text not null default 'human' check (source in ('human', 'dream', 'agent')),
  agent_name text,
  status text not null default 'confirmed' check (status in ('candidate', 'confirmed', 'retired')),
  human_locked boolean not null default false,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_workbench_memory_rules_owner
  on public.workbench_memory_rules(owner_id, status);

-- 2. Living Project Wiki Pages (Compiled Truth + Append-Only Timeline + replaced_because history)
create table if not exists public.workbench_wiki_pages (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  slug text not null,
  title text not null,
  page_type text not null default 'project' check (page_type in ('project', 'concept', 'decision')),
  domain text not null default 'Uncategorized',
  compiled_truth_md text not null default '',
  timeline_entries jsonb not null default '[]'::jsonb,
  contradictions jsonb not null default '[]'::jsonb,
  source_idea_ids jsonb not null default '[]'::jsonb,
  version_history jsonb not null default '[]'::jsonb,
  confidence numeric(4, 3) not null default 0.80,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, slug)
);

create index if not exists idx_workbench_wiki_pages_owner
  on public.workbench_wiki_pages(owner_id, slug);

-- 3. Typed Cross-Agent Handoffs (single-claim baton pass across Antigravity, Claude Code, Codex, Gemini)
create table if not exists public.workbench_handoffs (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_slug text not null default 'general',
  title text not null,
  from_agent text not null default 'agent',
  status text not null default 'open' check (status in ('open', 'claimed', 'completed')),
  claimed_by text,
  claimed_at timestamptz,
  summary text not null default '',
  what_worked jsonb not null default '[]'::jsonb,
  what_failed jsonb not null default '[]'::jsonb,
  open_questions jsonb not null default '[]'::jsonb,
  relevant_files jsonb not null default '[]'::jsonb,
  next_step text not null default '',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_workbench_handoffs_owner
  on public.workbench_handoffs(owner_id, status, created_at desc);

alter table public.workbench_memory_rules enable row level security;
alter table public.workbench_wiki_pages enable row level security;
alter table public.workbench_handoffs enable row level security;

revoke all on public.workbench_memory_rules, public.workbench_wiki_pages, public.workbench_handoffs from anon, authenticated;
grant select, insert, update, delete on public.workbench_memory_rules to authenticated;
grant select, insert, update, delete on public.workbench_wiki_pages to authenticated;
grant select, insert, update, delete on public.workbench_handoffs to authenticated;

drop policy if exists workbench_memory_rules_owner_all on public.workbench_memory_rules;
create policy workbench_memory_rules_owner_all
  on public.workbench_memory_rules
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

drop policy if exists workbench_wiki_pages_owner_all on public.workbench_wiki_pages;
create policy workbench_wiki_pages_owner_all
  on public.workbench_wiki_pages
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

drop policy if exists workbench_handoffs_owner_all on public.workbench_handoffs;
create policy workbench_handoffs_owner_all
  on public.workbench_handoffs
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

-- Helper: validate agent token & scope inside SECURITY DEFINER functions
create or replace function public._verify_workbench_agent_token(
  p_token_hash text,
  p_required_scope text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token public.workbench_agent_tokens%rowtype;
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
    -- Allow write:ideas to satisfy write:memory/write:handoffs for backwards compatibility
    if not (p_required_scope in ('write:memory', 'write:handoffs') and ('write:ideas' = any(v_token.scopes))) then
      return jsonb_build_object('ok', false, 'status', 403, 'error', 'Missing required scope: ' || p_required_scope);
    end if;
  end if;

  update public.workbench_agent_tokens
     set last_used_at = now()
   where id = v_token.id;

  return jsonb_build_object(
    'ok', true,
    'owner_id', v_token.owner_id,
    'label', v_token.label,
    'scopes', to_jsonb(v_token.scopes)
  );
end;
$$;

-- RPC 1: Read second-brain state (rules, wiki pages, handoffs)
create or replace function public.agent_get_second_brain(
  p_token_hash text,
  p_required_scope text default 'read:ideas'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth jsonb;
  v_owner uuid;
  v_rules jsonb;
  v_wiki jsonb;
  v_handoffs jsonb;
begin
  v_auth := public._verify_workbench_agent_token(p_token_hash, p_required_scope);
  if coalesce((v_auth->>'ok')::boolean, false) = false then
    return v_auth;
  end if;

  v_owner := (v_auth->>'owner_id')::uuid;

  select coalesce(jsonb_agg(to_jsonb(r) - 'owner_id' order by r.human_locked desc, r.confidence desc, r.updated_at desc), '[]'::jsonb)
    into v_rules
    from public.workbench_memory_rules r
   where r.owner_id = v_owner
     and r.status <> 'retired';

  select coalesce(jsonb_agg(to_jsonb(w) - 'owner_id' order by w.updated_at desc), '[]'::jsonb)
    into v_wiki
    from public.workbench_wiki_pages w
   where w.owner_id = v_owner;

  select coalesce(jsonb_agg(to_jsonb(h) - 'owner_id' order by h.created_at desc), '[]'::jsonb)
    into v_handoffs
    from (
      select * from public.workbench_handoffs
       where owner_id = v_owner
       order by created_at desc
       limit 30
    ) h;

  return jsonb_build_object(
    'ok', true,
    'status', 200,
    'rules', v_rules,
    'wiki_pages', v_wiki,
    'handoffs', v_handoffs
  );
end;
$$;

-- RPC 2: Create a typed cross-agent handoff
create or replace function public.agent_create_handoff(
  p_token_hash text,
  p_handoff jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth jsonb;
  v_owner uuid;
  v_id text;
begin
  v_auth := public._verify_workbench_agent_token(p_token_hash, 'write:handoffs');
  if coalesce((v_auth->>'ok')::boolean, false) = false then
    return v_auth;
  end if;

  v_owner := (v_auth->>'owner_id')::uuid;
  v_id := coalesce(nullif(trim(p_handoff->>'id'), ''), 'ho_' || floor(extract(epoch from now()) * 1000)::text);

  insert into public.workbench_handoffs (
    id, owner_id, project_slug, title, from_agent, status, summary,
    what_worked, what_failed, open_questions, relevant_files, next_step,
    expires_at, created_at, updated_at
  )
  values (
    v_id,
    v_owner,
    coalesce(nullif(trim(p_handoff->>'project_slug'), ''), 'general'),
    coalesce(nullif(trim(p_handoff->>'title'), ''), 'Agent Handoff'),
    coalesce(nullif(trim(p_handoff->>'from_agent'), ''), v_auth->>'label', 'agent'),
    'open',
    coalesce(p_handoff->>'summary', ''),
    coalesce(p_handoff->'what_worked', '[]'::jsonb),
    coalesce(p_handoff->'what_failed', '[]'::jsonb),
    coalesce(p_handoff->'open_questions', '[]'::jsonb),
    coalesce(p_handoff->'relevant_files', '[]'::jsonb),
    coalesce(p_handoff->>'next_step', ''),
    case when (p_handoff->>'expires_at') is not null then (p_handoff->>'expires_at')::timestamptz else now() + interval '14 days' end,
    now(),
    now()
  );

  return jsonb_build_object('ok', true, 'status', 201, 'id', v_id, 'status_label', 'open');
end;
$$;

-- RPC 3: Atomically claim an open handoff exactly once
create or replace function public.agent_claim_handoff(
  p_token_hash text,
  p_handoff_id text,
  p_claimer text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth jsonb;
  v_owner uuid;
  v_row public.workbench_handoffs%rowtype;
begin
  v_auth := public._verify_workbench_agent_token(p_token_hash, 'write:handoffs');
  if coalesce((v_auth->>'ok')::boolean, false) = false then
    return v_auth;
  end if;

  v_owner := (v_auth->>'owner_id')::uuid;

  update public.workbench_handoffs
     set status = 'claimed',
         claimed_by = coalesce(nullif(trim(p_claimer), ''), v_auth->>'label', 'agent'),
         claimed_at = now(),
         updated_at = now()
   where id = p_handoff_id
     and owner_id = v_owner
     and status = 'open'
   returning * into v_row;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'error', 'Handoff not found or already claimed by another agent.'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 200,
    'handoff', to_jsonb(v_row) - 'owner_id'
  );
end;
$$;

-- RPC 4: Remember a rule or preference (respecting human_locked precedence)
create or replace function public.agent_remember_rule(
  p_token_hash text,
  p_rule jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth jsonb;
  v_owner uuid;
  v_id text;
  v_existing public.workbench_memory_rules%rowtype;
begin
  v_auth := public._verify_workbench_agent_token(p_token_hash, 'write:memory');
  if coalesce((v_auth->>'ok')::boolean, false) = false then
    return v_auth;
  end if;

  v_owner := (v_auth->>'owner_id')::uuid;
  v_id := coalesce(nullif(trim(p_rule->>'id'), ''), 'rule_' || floor(extract(epoch from now()) * 1000)::text);

  select * into v_existing
    from public.workbench_memory_rules
   where id = v_id and owner_id = v_owner
   limit 1;

  if found and v_existing.human_locked then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'error', 'Rule is locked by owner (human edits always win over agent updates).'
    );
  end if;

  insert into public.workbench_memory_rules (
    id, owner_id, kind, title, rule_text, pattern, target_domain,
    confidence, evidence_count, applied_count, source, agent_name,
    status, human_locked, last_verified_at, created_at, updated_at
  )
  values (
    v_id,
    v_owner,
    coalesce(nullif(trim(p_rule->>'kind'), ''), 'preference'),
    coalesce(nullif(trim(p_rule->>'title'), ''), 'Agent Preference'),
    coalesce(nullif(trim(p_rule->>'rule_text'), ''), ''),
    nullif(trim(coalesce(p_rule->>'pattern', '')), ''),
    nullif(trim(coalesce(p_rule->>'target_domain', '')), ''),
    coalesce((p_rule->>'confidence')::numeric, 0.72),
    coalesce((p_rule->>'evidence_count')::integer, 1),
    0,
    'agent',
    coalesce(nullif(trim(p_rule->>'agent_name'), ''), v_auth->>'label', 'agent'),
    coalesce(nullif(trim(p_rule->>'status'), ''), 'candidate'),
    false,
    now(),
    now(),
    now()
  )
  on conflict (id) do update
    set rule_text = excluded.rule_text,
        title = excluded.title,
        evidence_count = public.workbench_memory_rules.evidence_count + 1,
        confidence = least(0.98, public.workbench_memory_rules.confidence + 0.08),
        updated_at = now()
  where not public.workbench_memory_rules.human_locked;

  return jsonb_build_object('ok', true, 'status', 200, 'id', v_id);
end;
$$;

-- RPC 5: Upsert a Living Project Wiki page with replaced_because version history
create or replace function public.agent_upsert_wiki_page(
  p_token_hash text,
  p_page jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth jsonb;
  v_owner uuid;
  v_slug text;
  v_id text;
  v_existing public.workbench_wiki_pages%rowtype;
  v_next_history jsonb;
  v_next_timeline jsonb;
begin
  v_auth := public._verify_workbench_agent_token(p_token_hash, 'write:memory');
  if coalesce((v_auth->>'ok')::boolean, false) = false then
    return v_auth;
  end if;

  v_owner := (v_auth->>'owner_id')::uuid;
  v_slug := lower(regexp_replace(coalesce(nullif(trim(p_page->>'slug'), ''), 'general'), '[^a-z0-9-]+', '-', 'g'));
  v_id := 'wiki_' || v_slug;

  select * into v_existing
    from public.workbench_wiki_pages
   where owner_id = v_owner and slug = v_slug
   limit 1;

  if found then
    v_next_history := (
      jsonb_build_array(
        jsonb_build_object(
          'replaced_at', now(),
          'replaced_by', coalesce(v_auth->>'label', 'agent'),
          'replaced_because', coalesce(nullif(trim(p_page->>'replaced_because'), ''), 'Updated compiled truth'),
          'previous_md', v_existing.compiled_truth_md
        )
      ) || coalesce(v_existing.version_history, '[]'::jsonb)
    );
    v_next_timeline := case
      when jsonb_typeof(p_page->'append_timeline') = 'object' then
        jsonb_build_array(p_page->'append_timeline') || coalesce(v_existing.timeline_entries, '[]'::jsonb)
      else coalesce(v_existing.timeline_entries, '[]'::jsonb)
    end;

    update public.workbench_wiki_pages
       set title = coalesce(nullif(trim(p_page->>'title'), ''), v_existing.title),
           domain = coalesce(nullif(trim(p_page->>'domain'), ''), v_existing.domain),
           compiled_truth_md = coalesce(nullif(p_page->>'compiled_truth_md', ''), v_existing.compiled_truth_md),
           timeline_entries = v_next_timeline,
           contradictions = coalesce(p_page->'contradictions', v_existing.contradictions),
           source_idea_ids = coalesce(p_page->'source_idea_ids', v_existing.source_idea_ids),
           version_history = v_next_history,
           last_verified_at = now(),
           updated_at = now()
     where id = v_existing.id;
  else
    insert into public.workbench_wiki_pages (
      id, owner_id, slug, title, page_type, domain, compiled_truth_md,
      timeline_entries, contradictions, source_idea_ids, version_history,
      confidence, last_verified_at, created_at, updated_at
    )
    values (
      v_id,
      v_owner,
      v_slug,
      coalesce(nullif(trim(p_page->>'title'), ''), v_slug),
      coalesce(nullif(trim(p_page->>'page_type'), ''), 'project'),
      coalesce(nullif(trim(p_page->>'domain'), ''), 'Uncategorized'),
      coalesce(p_page->>'compiled_truth_md', ''),
      case when jsonb_typeof(p_page->'append_timeline') = 'object'
        then jsonb_build_array(p_page->'append_timeline')
        else coalesce(p_page->'timeline_entries', '[]'::jsonb)
      end,
      coalesce(p_page->'contradictions', '[]'::jsonb),
      coalesce(p_page->'source_idea_ids', '[]'::jsonb),
      '[]'::jsonb,
      coalesce((p_page->>'confidence')::numeric, 0.80),
      now(),
      now(),
      now()
    );
  end if;

  return jsonb_build_object('ok', true, 'status', 200, 'slug', v_slug);
end;
$$;

revoke all on function public._verify_workbench_agent_token(text, text) from public;
revoke all on function public.agent_get_second_brain(text, text) from public;
revoke all on function public.agent_create_handoff(text, jsonb) from public;
revoke all on function public.agent_claim_handoff(text, text, text) from public;
revoke all on function public.agent_remember_rule(text, jsonb) from public;
revoke all on function public.agent_upsert_wiki_page(text, jsonb) from public;

grant execute on function public.agent_get_second_brain(text, text) to anon, authenticated;
grant execute on function public.agent_create_handoff(text, jsonb) to anon, authenticated;
grant execute on function public.agent_claim_handoff(text, text, text) to anon, authenticated;
grant execute on function public.agent_remember_rule(text, jsonb) to anon, authenticated;
grant execute on function public.agent_upsert_wiki_page(text, jsonb) to anon, authenticated;
