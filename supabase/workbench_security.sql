-- Optional extra security hardening & owner-only security audit log for RPA! Workbench.
-- Safe to run once in Supabase SQL Editor. Enforces strict owner-only RLS across all workbench tables.

-- 1. Explicitly ensure anon has ZERO direct table privileges on any Workbench table
revoke all on public.workbench_snapshots from public, anon;
revoke all on public.workbench_agent_tokens from public, anon;

do $$
begin
  if to_regclass('public.workbench_memory_rules') is not null then
    execute 'revoke all on public.workbench_memory_rules from public, anon';
  end if;
  if to_regclass('public.workbench_wiki_pages') is not null then
    execute 'revoke all on public.workbench_wiki_pages from public, anon';
  end if;
  if to_regclass('public.workbench_handoffs') is not null then
    execute 'revoke all on public.workbench_handoffs from public, anon';
  end if;
end $$;

-- 2. Owner-only Security Audit Log (tracks token creation, revocation, kill-switch, & vault events)
create table if not exists public.workbench_security_audit (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  actor text not null default 'owner',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_workbench_security_audit_owner
  on public.workbench_security_audit(owner_id, created_at desc);

alter table public.workbench_security_audit enable row level security;
revoke all on public.workbench_security_audit from public, anon, authenticated;
grant select, insert on public.workbench_security_audit to authenticated;

drop policy if exists workbench_security_audit_owner_all on public.workbench_security_audit;
create policy workbench_security_audit_owner_all
  on public.workbench_security_audit
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

-- 3. Automatic trigger logging every Agent Token mint or revocation into workbench_security_audit
create or replace function public.log_workbench_token_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.workbench_security_audit (owner_id, event_type, actor, detail)
    values (
      new.owner_id,
      'token_created',
      'owner',
      jsonb_build_object('label', new.label, 'prefix', new.token_prefix, 'scopes', new.scopes, 'expires_at', new.expires_at)
    );
  elsif tg_op = 'UPDATE' and old.revoked_at is null and new.revoked_at is not null then
    insert into public.workbench_security_audit (owner_id, event_type, actor, detail)
    values (
      new.owner_id,
      'token_revoked',
      'owner',
      jsonb_build_object('label', new.label, 'prefix', new.token_prefix)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_workbench_token_change on public.workbench_agent_tokens;
create trigger trg_log_workbench_token_change
  after insert or update on public.workbench_agent_tokens
  for each row execute function public.log_workbench_token_change();
