#!/usr/bin/env bash
# One-shot operator launcher for the already approved original FWH Team TEST photo.
# No live customer jobs, general Send, scheduler, new Google IDs or cleanup.
# Run as bash ci/phase5d_original_held_file_probe_once.sh, never via stdin.
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$repo_root"
project='vyocaujuwrivoqynvitm'
stop() { printf 'STOP: %s\n' "$*" >&2; exit 1; }

[[ -f "$repo_root/ci/phase5d_held_probe_migration_preflight.sh" ]] || stop 'Canonical migration preflight missing.'
for required in bash curl supabase mktemp; do
  command -v "$required" >/dev/null 2>&1 || stop "Missing $required."
done
bash ci/phase5d_held_probe_migration_preflight.sh --installed || stop 'Canonical Team TEST preflight did not pass.'

# Installed TEST key can be supplied by the caller environment.
# Never store credentials in the public repository or print them in test output.
worker_key="${FWH_CLIENT_DELIVERY_WORKER_SECRET:-}"
if [[ -z "$worker_key" ]]; then
  [[ -r /dev/tty ]] || stop 'A local interactive worker credential is required.'
  IFS= read -r -s -p 'Existing FWH worker credential (hidden): ' worker_key </dev/tty ||
    stop 'Worker credential unavailable.'
  printf '\n'
fi
[[ ${#worker_key} -ge 32 && "$worker_key" != *$'\r'* && "$worker_key" != *$'\n'* ]] ||
  stop 'Invalid worker credential.'

umask 077
header_file="$(mktemp)"
response_file="$(mktemp)"
mode_may_be_on=0
cleanup() {
  prior_exit=$?
  trap - EXIT INT TERM
  trap '' INT TERM
  if [[ "$mode_may_be_on" == 1 ]]; then
    printf 'Restoring TEST recovery OFF...\n'
    if supabase secrets set \
      FWH_CLIENT_DELIVERY_ACTIVE=false \
      FWH_CLIENT_TEST_PREFLIGHT_ENABLED=true \
      FWH_CLIENT_TEST_RECOVERY_ENABLED=false \
      --project-ref "$project" </dev/null; then
      printf 'PASS: TEST recovery OFF command accepted.\n'
    else
      printf 'CRITICAL STOP: TEST recovery OFF command failed.\n' >&2
      prior_exit=90
    fi
  fi
  rm -f -- "$header_file" "$response_file"
  exit "$prior_exit"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf 'x-fwh-delivery-secret: %s\n' "$worker_key" > "$header_file"
unset worker_key

# Local durable marker prevents an accidental second remote attempt after lost HTTP reply.
# It is intentionally OUTSIDE the clean Git tree.
state_root="${XDG_STATE_HOME:-${HOME:?}/.local/state}/field-work-hub"
mkdir -p -m 700 -- "$state_root"
attempt_marker="$state_root/phase5d-original-held-photo-id-probed"
if ! (set -C; printf 'Original TEST PHOTO ID GET forensic probe reserved; no repeat.\n' > "$attempt_marker") 2>/dev/null; then
  stop "Prior original PHOTO ID diagnostic attempt exists at $attempt_marker; no retry."
fi

# Supabase CLI must NOT consume script input; former stdin/heredoc launcher
# could finish mode change while swallowing the remaining curl instructions.
mode_may_be_on=1
printf 'Enabling narrow original-saved-photo TEST recovery only...\n'
supabase secrets set \
  FWH_CLIENT_DELIVERY_ACTIVE=false \
  FWH_CLIENT_TEST_PREFLIGHT_ENABLED=true \
  FWH_CLIENT_TEST_RECOVERY_ENABLED=true \
  --project-ref "$project" </dev/null || stop 'TEST recovery enable command failed.'

printf 'Inspecting the original reserved PHOTO file ID ONCE (metadata only)...\n'
curl_exit=0
http_status="$(curl --silent --show-error --retry 0 \
  --connect-timeout 10 --max-time 120 \
  --output "$response_file" --write-out '%{http_code}' \
  --request POST --header "@$header_file" \
  --header 'Content-Type: application/json' \
  --data-binary '{"operation":"inspect_original_held_first_photo_file"}' \
  "https://${project}.supabase.co/functions/v1/client-delivery")" || curl_exit=$?

printf 'Curl exit: %s | HTTP: %s\n' "$curl_exit" "${http_status:-none}"
if [[ -s "$response_file" ]]; then cat -- "$response_file"; printf '\n'; fi
if [[ "$curl_exit" != 0 || "$http_status" != 200 ]] ||
   ! grep -Eq '^\{"status":"HELD_TEST_FILE_(UNAVAILABLE_404|PRESENT_CANDIDATE|IDENTITY_MISMATCH|AUTH_DENIED|PROVIDER_UNCERTAIN)","http_status":(null|[0-9]{3})\}$' "$response_file"; then
  stop 'Unverified forensic status. NO RETRY; preserve held permit, session, and Google identity.'
fi
printf 'PASS: original file-ID metadata classified (NOT a photo receipt); global dispatch remains HELD.\n'
