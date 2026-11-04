-- Add the fourth independent course to the allowed course IDs.
alter table public.course_access drop constraint if exists course_access_course_id_check;
alter table public.course_access add constraint course_access_course_id_check check (course_id in ('python-renewable','fault-segmentation','energy-decision-ai','eage-python-course'));
alter table public.course_lessons drop constraint if exists course_lessons_course_id_check;
alter table public.course_lessons add constraint course_lessons_course_id_check check (course_id in ('python-renewable','fault-segmentation','energy-decision-ai','eage-python-course'));

insert into storage.buckets (id, name, public)
values ('private-courses', 'private-courses', false)
on conflict (id) do nothing;

create policy "course_files_read" on storage.objects for select to authenticated
using (
  bucket_id = 'private-courses' and (
    exists (select 1 from public.course_owners where user_id = (select auth.uid()))
    or exists (
      select 1 from public.course_access
      where user_id = (select auth.uid())
        and course_id = (storage.foldername(name))[1]
    )
  )
);
create policy "course_files_owner_insert" on storage.objects for insert to authenticated
with check (bucket_id = 'private-courses' and exists (select 1 from public.course_owners where user_id = (select auth.uid())));
create policy "course_files_owner_update" on storage.objects for update to authenticated
using (bucket_id = 'private-courses' and exists (select 1 from public.course_owners where user_id = (select auth.uid())))
with check (bucket_id = 'private-courses' and exists (select 1 from public.course_owners where user_id = (select auth.uid())));
create policy "course_files_owner_delete" on storage.objects for delete to authenticated
using (bucket_id = 'private-courses' and exists (select 1 from public.course_owners where user_id = (select auth.uid())));
