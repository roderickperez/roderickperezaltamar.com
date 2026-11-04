-- Add a limited publishing account after creating it in Supabase Authentication.
-- Only insert the dedicated publisher's user ID and explicit course IDs.
create table if not exists public.course_publishers (
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id text not null check (course_id in ('python-renewable','eage-python-course','fault-segmentation','energy-decision-ai')),
  primary key (user_id, course_id)
);
alter table public.course_publishers enable row level security;
revoke all on public.course_publishers from anon, authenticated;
grant select on public.course_publishers to authenticated;
create policy "publisher_read_self" on public.course_publishers for select to authenticated using (user_id = (select auth.uid()));
create policy "publisher_read_objects" on storage.objects for select to authenticated using (
  bucket_id = 'private-courses' and exists (
    select 1 from public.course_publishers where user_id = (select auth.uid()) and course_id = (storage.foldername(name))[1]
  )
);
create policy "publisher_insert_objects" on storage.objects for insert to authenticated with check (
  bucket_id = 'private-courses' and exists (
    select 1 from public.course_publishers where user_id = (select auth.uid()) and course_id = (storage.foldername(name))[1]
  )
);
create policy "publisher_update_objects" on storage.objects for update to authenticated using (
  bucket_id = 'private-courses' and exists (
    select 1 from public.course_publishers where user_id = (select auth.uid()) and course_id = (storage.foldername(name))[1]
  )
) with check (
  bucket_id = 'private-courses' and exists (
    select 1 from public.course_publishers where user_id = (select auth.uid()) and course_id = (storage.foldername(name))[1]
  )
);
