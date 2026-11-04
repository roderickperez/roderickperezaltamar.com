# Course publishing support

This folder contains the publisher, least-privilege database policy, and offline
tests. The publisher needs a dedicated Supabase Auth account with explicit rows
in course_publishers, and GitHub Actions secrets COURSE_PUBLISHER_EMAIL and
COURSE_PUBLISHER_PASSWORD. Never use an owner account or Supabase service key.

Each build is uploaded into content-addressed objects. The manifest is replaced
only after every file uploads, preserving the current release if an upload fails.
Older content objects remain in private storage; storage usage must be monitored.

Run the offline tests with:
  python automation/test_publish_course.py
  node automation/test-manifest.cjs
