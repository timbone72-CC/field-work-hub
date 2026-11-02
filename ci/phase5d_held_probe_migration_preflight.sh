#!/usr/bin/env bash
# Read-only canonical source/Team TEST parity for Phase 5D held-session forensic 121st
# migration. Never calls a write-capable database or provider operation.
set -euo pipefail
repo='timbone72-CC/field-work-hub'
branch='feat/phase-5-6-dashboard-workflow'
project='vyocaujuwrivoqynvitm'
last='20261026150000_phase_5_original_test_held_session_probe.sql'
stop(){ printf 'STOP: %s\n' "$1" >&2; exit 1; }
[[ $# == 1 && ( "$1" == '--pending' || "$1" == '--installed' ) ]] ||
 stop 'Expected exactly one of --pending or --installed.'
mode="$1"
for tool in git gh supabase; do
 command -v "$tool" >/dev/null 2>&1 || stop "Missing $tool."
done
[[ -f AGENTS.md && -f supabase/config.toml ]] ||
 stop 'Run from existing FWH checkout root.'
[[ "$(git branch --show-current)" == "$branch" ]] ||
 stop 'Not the authoritative PR #40 branch.'
[[ -z "$(git status --porcelain)" ]] ||
 stop 'FWH working tree is not clean.'
case "$(git remote get-url origin)" in
 *timbone72-CC/field-work-hub*|*timbone72-CC/field-photo-prep-team*) ;;
 *) stop 'Wrong origin repository.';;
esac
local_sha="$(git rev-parse HEAD)"
current="$(gh api "repos/$repo/pulls/40" --jq '.head.sha')"
[[ -n "$current" && "$local_sha" == "$current" ]] ||
 stop 'Checkout is not the current exact PR #40 head.'
[[ "$(gh api "repos/$repo/pulls/40" --jq '.draft')" == 'true' ]] ||
 stop 'PR #40 is not in the expected draft state.'
[[ "$(cat supabase/.temp/project-ref 2>/dev/null)" == "$project" ]] ||
 stop 'Wrong linked Supabase project; never use the original FPP database.'
count="$(find supabase/migrations -maxdepth 1 -name '*.sql' -type f | wc -l | tr -d ' ')"
[[ "$count" == '121' && -f "supabase/migrations/$last" ]] ||
 stop 'Canonical source migrations are not exactly 121.'
out="$(mktemp)"
trap 'rm -f "$out"' EXIT
supabase db push --dry-run --linked >"$out" 2>&1 ||
 stop 'Supabase linked dry-run failed; no migration was applied by this helper.'
mapfile -t found < <(grep -Eo '20[0-9]{12}_[A-Za-z0-9_]+[.]sql' "$out" | sort -u || true)
if [[ "$mode" == '--pending' ]]; then
 [[ ${#found[@]} == 1 && "${found[0]}" == "$last" ]] ||
  stop 'Expected only held-probe migration 121 pending; do not apply.'
 if grep -Fqx 'Remote database is up to date.' "$out"; then
  stop 'Contradictory CLI result: both pending and up to date.'
 fi
 printf 'PASS: exact FWH PR #40 HEAD %s, Team TEST %s\n' "$local_sha" "$project"
 printf 'PASS: 121 source migrations, exactly one pending: %s\n' "$last"
 printf 'READ ONLY: NO MIGRATION APPLIED. No delivery enabled.\n'
else
 [[ ${#found[@]} == 0 ]] ||
  stop 'Unexpected pending migration remains after installation.'
 grep -Fqx 'Remote database is up to date.' "$out" ||
  stop 'Linked database did not explicitly confirm up to date.'
 printf 'PASS: exact FWH PR #40 HEAD %s, Team TEST %s\n' "$local_sha" "$project"
 printf 'PASS: 121 source migrations, zero pending, remote up to date.\n'
 printf 'READ ONLY: NO MIGRATION APPLIED. No delivery enabled.\n'
fi
