#!/usr/bin/env bash
# Read-only Phase 5D canonical Team migration staging preflight.
# Does not install migrations, create cron jobs, deploy workers, or enable Send.
set -euo pipefail

repo="timbone72-CC/field-work-hub"
branch="feat/phase-5-6-dashboard-workflow"
project="vyocaujuwrivoqynvitm"
expected_count=107
pending=(
  "20261019170000_phase_5_delivery_active_lease_resume_read.sql"
  "20261019210000_phase_5_delivery_next_reserved_item_read.sql"
  "20261020003000_phase_5_atomic_delivery_file_reservation.sql"
  "20261020010000_phase_5_final_delivery_provider_snapshot.sql"
)

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
for name in "${pending[@]}"; do
  [[ -f "supabase/migrations/$name" ]] ||
    stop "Missing canonical pending migration $name."
done

out="$(mktemp)"
trap 'rm -f "$out"' EXIT
if ! supabase db push --dry-run --linked >"$out" 2>&1; then
  stop "Supabase canonical dry-run failed. Inspect the local CLI output; no migration was applied by this script."
fi
mapfile -t dry_run_migrations < <(
  grep -Eo '20[0-9]{12}_[a-zA-Z0-9_]+[.]sql' "$out" | sort -u
)
[[ "${#dry_run_migrations[@]}" -eq "${#pending[@]}" ]] ||
  stop "Dry-run migration set is not exactly the four reviewed canonical versions."
for name in "${pending[@]}"; do
  if ! printf '%s\n' "${dry_run_migrations[@]}" | grep -Fxq "$name"; then
    stop "Pending canonical migration $name not listed by the dry-run."
  fi
done

printf 'PASS: exact clean PR #40 HEAD %s\n' "$local_sha"
printf 'PASS: linked Team TEST project %s, %s canonical source migrations\n' "$project" "$count"
printf 'PASS: dry-run includes all four expected unapplied canonical migrations:\n'
printf '  %s\n' "${pending[@]}"
printf '\nNO MIGRATIONS APPLIED. NO WORKERS OR CLIENT DELIVERY ENABLED.\n'
printf 'This does not replace a manual full dry-run review, live-state safety check,\n'
printf 'advisor review, or the governed physical provider/Android evidence gate.\n'
