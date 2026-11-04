-- Run in a new Supabase project's SQL Editor as project administrator.
-- Populate course_owners from the dashboard after creating your own auth user.
create table public.course_owners (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table public.course_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id text not null check (course_id in ('python-renewable','fault-segmentation','energy-decision-ai')),
  primary key (user_id, course_id)
);
create table public.course_lessons (
  id bigint generated always as identity primary key,
  course_id text not null check (course_id in ('python-renewable','fault-segmentation','energy-decision-ai')),
  position integer not null,
  title text not null,
  body text not null default '',
  unique (course_id, position)
);
alter table public.course_owners enable row level security;
alter table public.course_access enable row level security;
alter table public.course_lessons enable row level security;
revoke all on public.course_owners, public.course_access, public.course_lessons from anon, authenticated;
grant select on public.course_owners to authenticated;
grant select, insert, update, delete on public.course_access, public.course_lessons to authenticated;
grant usage, select on sequence public.course_lessons_id_seq to authenticated;
create policy owners_read_self on public.course_owners for select to authenticated using (user_id = (select auth.uid()));
create policy grants_read on public.course_access for select to authenticated using (
  user_id = (select auth.uid()) or exists (select 1 from public.course_owners where user_id = (select auth.uid()))
);
create policy grants_owner_write on public.course_access for all to authenticated
using (exists (select 1 from public.course_owners where user_id = (select auth.uid())))
with check (exists (select 1 from public.course_owners where user_id = (select auth.uid())));
create policy lessons_read on public.course_lessons for select to authenticated using (
  exists (select 1 from public.course_owners where user_id = (select auth.uid()))
  or exists (select 1 from public.course_access where user_id = (select auth.uid()) and course_id = course_lessons.course_id)
);
create policy lessons_owner_write on public.course_lessons for all to authenticated
using (exists (select 1 from public.course_owners where user_id = (select auth.uid())))
with check (exists (select 1 from public.course_owners where user_id = (select auth.uid())));
