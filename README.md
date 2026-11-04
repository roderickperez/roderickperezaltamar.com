# roderickperezaltamar.com

Personal landing page and course hub. Course content is not yet hosted.

## Sign-in setup

The login screen uses Supabase Auth. Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (the public publishable/anon key only) as Vercel environment variables, then redeploy. Never put a Supabase secret or service-role key in this variable.

In Supabase Authentication, set the site URL and redirect URLs to the Vercel domain (and custom domain once connected), enable the Email and Google providers, and disable public signups for invitation-only access. Google requires OAuth credentials from Google Cloud. Invite people through Authentication > Users. Configure SMTP for real users.

The UI is not an authorization boundary. Future course materials must be stored privately and access checked on the server or enforced with Supabase Row Level Security and Storage policies. Do not place protected materials in this public repository or public static files.
