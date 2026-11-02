#!/usr/bin/env bash
# Temporary Phase 5/6 Admin preview on the existing GitHub Pages origin.
# Refuses to replace an environment's overall branch protection mode.
set -euo pipefail
REPO="timbone72-CC/field-work-hub"
BRANCH="feat/phase-5-6-dashboard-workflow"
ENV_URL="repos/$REPO/environments/github-pages"
POLICY_URL="$ENV_URL/deployment-branch-policies"
ROOT="https://timbone72-cc.github.io/field-work-hub/"
PREVIEW="$ROOT""phase56-review/"
TMP="$(mktemp -d)"
CREATED_POLICY=""
cleanup() {
  if [[ -n "$CREATED_POLICY" ]]; then
    if gh api -X DELETE "$POLICY_URL/$CREATED_POLICY" >/dev/null; then
      echo "Restored Pages branch policy: removed only the temporary PR #40 exception."
    else
      echo "STOP: Could not remove temporary Pages policy ID $CREATED_POLICY." >&2
      echo "Visit https://github.com/$REPO/settings/environments to remove that EXACT entry." >&2
    fi
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

verify_live_preview() {
  # Git fetch into FETCH_HEAD, because thin checkouts may have no origin/main ref.
  git fetch --quiet origin refs/heads/main
  git show FETCH_HEAD:dashboard/index.html > "$TMP/main.html"
  local main_hash
  main_hash="$(sha256sum "$TMP/main.html" | cut -d' ' -f1)"
  local verified=0
  for i in $(seq 1 12); do
    if curl -fsSL --max-time 12 "$PREVIEW" -o "$TMP/preview.html" &&
       grep -q 'id="job-photos"' "$TMP/preview.html" &&
       grep -q 'private-review.js?v=' "$TMP/preview.html" &&
       curl -fsSL --max-time 12 "$PREVIEW""private-review.js" -o "$TMP/private-review.js" &&
       grep -q 'admin-private-photo' "$TMP/private-review.js" &&
       curl -fsSL --max-time 12 "$ROOT" -o "$TMP/root.html"; then
      local live_hash
      live_hash="$(sha256sum "$TMP/root.html" | cut -d' ' -f1)"
      if [[ "$live_hash" == "$main_hash" ]]; then verified=1; break; fi
    fi
    sleep 10
  done
  if [[ "$verified" == "1" ]]; then
    echo "PASS: Private Admin preview is live at $PREVIEW"
    echo "PASS: Normal Admin root index.html matches current main byte-for-byte."
    echo "This path is test-only; do not press Send or delete photo evidence."
  else
    echo "BLOCKED: Site/CDN preview or unchanged main root cannot yet be confirmed." >&2
    echo "Check $PREVIEW and $ROOT; do not dispatch another deployment merely to retry this read-only check." >&2
    return 1
  fi
}


if [[ "$#" -gt 1 ]]; then
  echo "Usage: bash ci/stage_phase56_review_preview.sh [--verify-only|--restore]" >&2; exit 2
fi
MODE_ARG=""
if [[ "$#" -eq 1 ]]; then MODE_ARG="$1"; fi
if [[ -n "$MODE_ARG" && "$MODE_ARG" != "--restore" && "$MODE_ARG" != "--verify-only" ]]; then
  echo "Invalid option." >&2; exit 2
fi
for cmd in gh git python3 curl; do
  command -v "$cmd" >/dev/null || { echo "Missing $cmd. No deployment requested." >&2; exit 2; }
done
if [[ "$MODE_ARG" == "--restore" ]]; then
  echo "Restoring the existing main-only Admin dashboard; /phase56-review/ will be removed."
  gh workflow run pages.yml --repo "$REPO" --ref main
  echo "Main rollback requested. Confirm it completes at:"
  echo "https://github.com/$REPO/actions/workflows/pages.yml"
  exit 0
fi
if [[ "$MODE_ARG" == "--verify-only" ]]; then
  echo "Read-only check of the deployed preview. No workflow dispatch or permission changes."
  verify_live_preview
  exit 0
fi
if [[ "$(git branch --show-current)" != "$BRANCH" ]]; then
  echo "STOP: Not in the approved PR #40 checkout." >&2; exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "STOP: Local changes exist; reconcile them before staging." >&2; exit 1
fi
REMOTE="$(git remote get-url origin)"
case "$REMOTE" in
  *timbone72-CC/field-work-hub*|*timbone72-CC/field-photo-prep-team*) ;;
  *) echo "STOP: Remote is not the approved Field Work Hub repo." >&2; exit 1 ;;
esac
LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(gh api "repos/$REPO/pulls/40" --jq '.head.sha')"
if [[ "$REMOTE_SHA" != "$LOCAL_SHA" ]]; then
  echo "STOP: Local checkout does not match live PR #40." >&2; exit 1
fi
if [[ "$(gh api "repos/$REPO/pulls/40" --jq '.draft')" != "true" ]]; then
  echo "STOP: PR #40 is not in its agreed draft state." >&2; exit 1
fi

# Only append a literal branch to an EXISTING custom allowlist.
# If the environment instead requires protected branches, do not change modes.
gh api "$ENV_URL" > "$TMP/environment.json"
POLICY_MODE="$(python3 - "$TMP/environment.json" <<'PY'
import json, sys
env=json.load(open(sys.argv[1], encoding='utf-8'))
policy=env.get('deployment_branch_policy')
if policy is None: print('unrestricted')
elif policy.get('custom_branch_policies') is True and policy.get('protected_branches') is False:
    print('custom')
else: print('protected-or-unknown')
PY
)"
if [[ "$POLICY_MODE" == "protected-or-unknown" ]]; then
  echo "STOP: Pages uses protected-branch rules, not a custom allowlist." >&2
  echo "Inspect GitHub Settings > Environments > github-pages before permitting an exception." >&2
  exit 1
fi
if [[ "$POLICY_MODE" == "custom" ]]; then
  gh api "$POLICY_URL?per_page=100" > "$TMP/policies.json"
  read -r MAIN_ALLOWED EXISTING_POLICY < <(python3 - "$TMP/policies.json" "$BRANCH" <<'PY'
import json,sys
data=json.load(open(sys.argv[1], encoding='utf-8'))
assert data['total_count'] <= 100, 'Too many rules to safely inspect'
rules=data['branch_policies']
print(int(any(p['name']=='main' for p in rules)),
      next((p['id'] for p in rules if p['name']==sys.argv[2]), 0))
PY
)
  if [[ "$MAIN_ALLOWED" != "1" ]]; then
    echo "STOP: Exact main allowlist entry absent; safe rollback is not assured." >&2
    exit 1
  fi
  if [[ "$EXISTING_POLICY" != "0" ]]; then
    echo "Approved branch already allowed; original rule left untouched."
  else
    CREATED_POLICY="$(gh api -X POST "$POLICY_URL" -f name="$BRANCH" -f type=branch --jq '.id')"
    [[ "$CREATED_POLICY" =~ ^[0-9]+$ ]] || { echo "Could not confirm temporary policy." >&2; exit 1; }
    echo "Temporarily allowed ONLY PR #40's literal implementation branch."
  fi
fi

START="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
echo "Dispatching manual preview; original Admin root remains copied byte-for-byte from main."
gh workflow run pages.yml --repo "$REPO" --ref "$BRANCH" -f phase56_preview=true
RUN=""
for i in $(seq 1 20); do
  gh run list --repo "$REPO" --workflow pages.yml --branch "$BRANCH" --event workflow_dispatch \
    --limit 12 --json databaseId,headSha,createdAt > "$TMP/runs.json"
  RUN="$(python3 - "$TMP/runs.json" "$REMOTE_SHA" "$START" <<'PY'
from datetime import datetime,timedelta
import json,sys
runs=json.load(open(sys.argv[1], encoding='utf-8'))
sha,start=sys.argv[2],datetime.fromisoformat(sys.argv[3].replace('Z','+00:00'))
for r in runs:
    dt=datetime.fromisoformat(r['createdAt'].replace('Z','+00:00'))
    if r['headSha']==sha and dt>=start-timedelta(seconds=20):
        print(r['databaseId']);break
PY
)"
  if [[ -n "$RUN" ]]; then break; fi
  sleep 3
done
if [[ -z "$RUN" ]]; then
  echo "STOP: Dispatch sent but no matching run found. Inspect Actions." >&2; exit 1
fi
echo "Deployment run: https://github.com/$REPO/actions/runs/$RUN"
echo "If GitHub requires environment approval, complete it from the Actions page."
gh run watch "$RUN" --repo "$REPO" --interval 10 --exit-status
if [[ "$(gh run view "$RUN" --repo "$REPO" --json conclusion --jq '.conclusion')" != "success" ]]; then
  echo "STOP: Pages deployment did not pass." >&2; exit 1
fi

verify_live_preview
