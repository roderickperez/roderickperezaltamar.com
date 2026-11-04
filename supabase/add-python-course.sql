-- Add the fourth independent course to the allowed course IDs.
alter table public.course_access drop constraint if exists course_access_course_id_check;
alter table public.course_access add constraint course_access_course_id_check check (course_id in ('python-renewable','fault-segmentation','energy-decision-ai','eage-python-course'));
alter table public.course_lessons drop constraint if exists course_lessons_course_id_check;
alter table public.course_lessons add constraint course_lessons_course_id_check check (course_id in ('python-renewable','fault-segmentation','energy-decision-ai','eage-python-course'));
