-- Permit learners of the three specialist courses to read the shared Python course.
-- Run as a Supabase project administrator after the private-courses bucket exists.
-- Existing direct grants and course ownership continue to work unchanged.
drop policy if exists "specialist_learners_read_python" on storage.objects;
create policy "specialist_learners_read_python" on storage.objects for select to authenticated
using (
  bucket_id = 'private-courses'
  and (storage.foldername(name))[1] = 'eage-python-course'
  and exists (
    select 1 from public.course_access
    where user_id = (select auth.uid())
      and course_id in ('python-renewable', 'fault-segmentation', 'energy-decision-ai')
  )
);
