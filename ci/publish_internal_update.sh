#!/usr/bin/env bash
# Operator-confirmed only: never publish a public debug-signed APK on a PR push.
set -euo pipefail
if [[ $# -ne 1 || ! "$1" =~ ^[0-9]+$ ]]; then
  echo "Usage: bash ci/publish_internal_update.sh <successful-android-ci-run-id>" >&2
  exit 2
fi
RUN_ID="$1"
REPO="timbone72-CC/field-work-hub"
command -v gh >/dev/null || { echo "GitHub CLI required." >&2; exit 2; }
command -v python3 >/dev/null || { echo "Python 3 required." >&2; exit 2; }
RESULT="$(gh run view "$RUN_ID" --repo "$REPO" --json conclusion --jq '.conclusion')"
HEAD="$(gh run view "$RUN_ID" --repo "$REPO" --json headSha --jq '.headSha')"
if [[ "$RESULT" != "success" || ! "$HEAD" =~ ^[0-9a-f]{40}$ ]]; then
  echo "STOP: the requested Android CI run did not pass." >&2
  exit 1
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
gh run download "$RUN_ID" --repo "$REPO" --name field-work-hub-internal-direct-release --dir "$TMP"
APK="$TMP/Field-Work-Hub-Internal.apk"
META="$TMP/internal-release-metadata.json"
TAG="$(python3 - "$APK" "$META" "$HEAD" <<'PY'
import hashlib, json, pathlib, sys
apk, metadata, sha = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
facts = json.loads(metadata.read_text())
assert facts["source_commit"] == sha
assert facts["package"] == "com.inandout.fieldphotoprep.team.internal"
assert facts["room_version"] == 5
assert facts["signer_sha256"] == "1bbff192f97a8a24c6f812d77df6847eb9759b3afb3c4b210d9e6c251f4eecfe"
assert facts["version_code"] >= 22 and facts["version_code"] % 2 == 0
assert 100_000 <= apk.stat().st_size <= 64 * 1024 * 1024
assert hashlib.sha256(apk.read_bytes()).hexdigest() == facts["sha256"]
print("fwh-internal-v" + str(facts["version_code"]))
PY
)"
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "STOP: this version already exists. Never overwrite a release." >&2
  exit 1
fi
echo "Public internal TEST APK from CI $RUN_ID, commit $HEAD, tag $TAG."
echo "This publicly distributes the signed APK; it does not merge the PR."
read -r -p "Type PUBLISH to confirm: " REPLY
if [[ "$REPLY" != "PUBLISH" ]]; then echo "No release published."; exit 0; fi
gh release create "$TAG" "$APK" --repo "$REPO" --target "$HEAD" \
  --title "Field Work Hub Internal $TAG (TEST)" \
  --notes "Internal debug-signed TEST APK. Install over the existing app. Never clear saved work or photos."
echo "Direct APK link:"
echo "https://github.com/$REPO/releases/download/$TAG/Field-Work-Hub-Internal.apk"
