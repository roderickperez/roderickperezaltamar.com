#!/usr/bin/env bash
# Run once in an interactive terminal. Password is not echoed or stored locally.
set -euo pipefail
if [[ ! -t 0 ]]; then
  printf '%s\n' 'Run this script in an interactive terminal.' >&2
  exit 1
fi
command -v gh >/dev/null || { printf '%s\n' 'GitHub CLI is required.' >&2; exit 1; }
printf 'Website owner email: '
IFS= read -r publisher_email
printf 'Website owner password (hidden): '
IFS= read -r -s publisher_password
printf '\n'
if [[ -z "$publisher_email" || -z "$publisher_password" ]]; then
  printf '%s\n' 'Email and password are required.' >&2
  exit 1
fi
for repo in EAGE_Python_course EAGE_PythonRenewableEnergyCourse EAGE_faultSegmentation EAGE_DecisionAnalysis_AI; do
  printf 'Configuring %s...\n' "$repo"
  printf '%s' "$publisher_email" | gh secret set COURSE_PUBLISHER_EMAIL --repo "roderickperez/$repo"
  printf '%s' "$publisher_password" | gh secret set COURSE_PUBLISHER_PASSWORD --repo "roderickperez/$repo"
done
unset publisher_email publisher_password
printf '%s\n' 'GitHub secrets saved. Return to Codex to verify publishing.'
