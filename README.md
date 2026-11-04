# RPA personal hub

The site contains project pages, course overview pages and separate learning pages. The learning pages use a single Supabase account with independent per-course authorizations; this is not a separate account per course.

## Setup (not active until configured)
1. Create a Supabase project. Add public SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (publishable or legacy anon key only) to Vercel, then redeploy. Never expose a secret or service-role key.
2. Run supabase/schema.sql in Supabase SQL Editor as project administrator, once on a new project.
3. Enable email/password and Google providers in Supabase. Set the Site URL and allowed redirects for the custom domain and each course learning page. Configure Google OAuth and SMTP as required.
4. Create your own Supabase Auth user, then insert its user UUID into public.course_owners through the Supabase dashboard or SQL Editor. Do not add any other owners. A user must have an owner row to administer course data. The owner can view every course.
5. Invite learners via Supabase Auth and add their auth user UUID and the desired course_id to course_access. Repeat per course; users see no lessons until granted access. After accepting their invitation, users may set a password from the Account menu.
6. Add lesson text to course_lessons with the correct course_id and unique position. Authorized lessons are loaded through RLS directly into the corresponding learning page.

Course IDs: python-renewable, fault-segmentation, energy-decision-ai. Auth and row-level policies must be tested with owner, invited and uninvited accounts before adding private content. Keep videos and files in private storage with their own access policies; public files, external links and the Git repository are not access-controlled. Do not add real course content to the repository.
