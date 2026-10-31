#!/usr/bin/env bash
# Read-only Phase 5D canonical Team migration parity preflight.
# All 119 canonical migrations are installed. Verify that the linked
# Team TEST database has ZERO pending migrations before provider testing.
# Never apply from this helper.
# It does not install
# migrations, create cron jobs, deploy workers, or enable Send.
set -euo pipefail

repo="timbone72-CC/field-work-hub"
branch="feat/phase-5-6-dashboard-workflow"
project="vyocaujuwrivoqynvitm"
expected_count=119
last_installed="20261024220000_phase_5_original_test_first_photo_continuation.sql"

stop(){ printf 'STOP: %s\n' "$1" >&2; exit 1; }
for program in git gh supabase; do
  command -v "$program" >/dev/null 2>&1 || stop "Missing $program."
done
[[ -f AGENTS.md && -f supabase/config.toml ]] || stop "Not in the FWH repository root."
[[ "$(git branch --show-current)" == "$branch" ]] || stop "Not on PR #40's implementation branch."
[[ -z "$(git status --porcelain)" ]] || stop "Working tree is not clean."
case "$(git remote get-url origin)" in
  *timbone72-CC/field-work-hub*|*timbone72-CC/field-photo-prep-team*) ;;
  *) stop "Remote is not the existing FWH repository." ;;
esac

local_sha="$(git rev-parse HEAD)"
pr_sha="$(gh api "repos/$repo/pulls/40" --jq '.head.sha')"
[[ -n "$pr_sha" && "$local_sha" == "$pr_sha" ]] ||
  stop "Local HEAD differs from the current authoritative PR #40."
[[ "$(gh api "repos/$repo/pulls/40" --jq '.draft')" == "true" ]] ||
  stop "PR #40 is no longer in the expected draft state."

[[ "$(cat supabase/.temp/project-ref 2>/dev/null)" == "$project" ]] ||
  stop "Linked Supabase project is not the FWH Team TEST project."
count="$(find supabase/migrations -maxdepth 1 -name '*.sql' -type f | wc -l | tr -d ' ')"
[[ "$count" == "$expected_count" ]] ||
  stop "Canonical source migration count changed; re-reconcile before rollout."
[[ -f "supabase/migrations/$last_installed" ]] ||
  stop "Missing known-installed canonical migration $last_installed."

out="$(mktemp)"
trap 'rm -f "$out"' EXIT
if ! supabase db push --dry-run --linked >"$out" 2>&1; then
  stop "Supabase canonical dry-run failed. Inspect the local CLI output; no migration was applied by this script."
fi
mapfile -t dry_run_migrations < <(
  grep -Eo '20[0-9]{12}_[a-zA-Z0-9_]+[.]sql' "$out" | sort -u
)
# Fail closed if any migration appears pending, including an old version.
# CLI exit 0 is not enough: require its explicit up-to-date confirmation.
[[ "${#dry_run_migrations[@]}" -eq 0 ]] ||
  stop "Unexpected pending canonical migrations; stop and reconcile before provider testing."
grep -Fqx 'Remote database is up to date.' "$out" ||
  stop "Dry-run did not confirm the linked database is up to date."

printf 'PASS: exact clean PR #40 HEAD %s\n' "$local_sha"
printf 'PASS: linked Team TEST project %s, %s canonical source migrations\n' "$project" "$count"
printf 'PASS: linked dry-run confirms zero pending migrations and Remote database is up to date.\n'
printf '\nNO MIGRATIONS APPLIED. NO WORKERS OR CLIENT DELIVERY ENABLED.\n'
printf 'This does not replace separate live SQL grant/worker readiness checks,\n'
printf 'provider and Android evidence, or the governed activation gate.\n'
