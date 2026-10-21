#!/usr/bin/env bash
# Read-only Phase 5D canonical Team migration parity preflight.
# The 108th canonical migration was installed in TEST on 2026-10-19.
# This checks that NO further migrations are pending. It does not install
# migrations, create cron jobs, deploy workers, or enable Send.
set -euo pipefail

repo="timbone72-CC/field-work-hub"
branch="feat/phase-5-6-dashboard-workflow"
project="vyocaujuwrivoqynvitm"
expected_count=108
last_installed="20261020020000_phase_5_delivery_dispatch_singleflight.sql"

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
# A successful CLI process alone is not proof of parity: insist on BOTH
# an empty pending set and the CLI's positive up-to-date confirmation.
[[ "${#dry_run_migrations[@]}" -eq 0 ]] ||
  stop "Unexpected pending canonical migrations; stop and reconcile with the current approved plan."
grep -Eq '^[[:space:]]*Remote database is up to date[.][[:space:]]*
 "$out" ||
  stop "Dry-run did not positively confirm installed migrations are up to date."

printf 'PASS: exact clean PR #40 HEAD %s\n' "$local_sha"
printf 'PASS: linked Team TEST project %s, %s canonical source migrations\n' "$project" "$count"
printf 'PASS: linked dry-run confirms zero pending migrations after the installed dispatch migration.\n'
printf '\nNO MIGRATIONS APPLIED. NO WORKERS OR CLIENT DELIVERY ENABLED.\n'
printf 'This does not replace separate live SQL permission/worker readiness checks,\n'
printf 'provider and Android evidence, or the governed activation gate.\n'
