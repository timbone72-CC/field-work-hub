#!/usr/bin/env bash
# Read-only Phase 5D canonical Team migration parity preflight.
# The first 112 canonical migrations are installed. Verify exactly the
# 113th canonical atomic original TEST lease/dispatch migration is pending.
# Never apply from this helper.
# It does not install
# migrations, create cron jobs, deploy workers, or enable Send.
set -euo pipefail

repo="timbone72-CC/field-work-hub"
branch="feat/phase-5-6-dashboard-workflow"
project="vyocaujuwrivoqynvitm"
expected_count=113
last_installed="20261023190447_phase_5_exact_test_expired_lease_recovery.sql"
expected_pending="20261024020428_phase_5_atomic_original_lease_dispatch.sql"

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
[[ -f "supabase/migrations/$expected_pending" ]] ||
  stop "Missing exact approved pending TEST recovery migration $expected_pending."

out="$(mktemp)"
trap 'rm -f "$out"' EXIT
if ! supabase db push --dry-run --linked >"$out" 2>&1; then
  stop "Supabase canonical dry-run failed. Inspect the local CLI output; no migration was applied by this script."
fi
mapfile -t dry_run_migrations < <(
  grep -Eo '20[0-9]{12}_[a-zA-Z0-9_]+[.]sql' "$out" | sort -u
)
# Fail closed unless this precise known readiness migration is the ONLY
# pending version. A clean/successful CLI exit by itself proves nothing.
[[ "${#dry_run_migrations[@]}" -eq 1 &&
   "${dry_run_migrations[0]}" == "$expected_pending" ]] ||
  stop "Unexpected pending canonical migrations; stop and reconcile with the current approved plan."
if grep -Fqx 'Remote database is up to date.' "$out"; then
  stop "Dry-run reports no pending work despite the expected readiness migration."
fi

printf 'PASS: exact clean PR #40 HEAD %s\n' "$local_sha"
printf 'PASS: linked Team TEST project %s, %s canonical source migrations\n' "$project" "$count"
printf 'PASS: linked dry-run identifies the one exact pending atomic TEST recovery migration; nothing applied.\n'
printf '\nNO MIGRATIONS APPLIED. NO WORKERS OR CLIENT DELIVERY ENABLED.\n'
printf 'This does not replace separate live SQL grant/worker readiness checks,\n'
printf 'provider and Android evidence, or the governed activation gate.\n'
