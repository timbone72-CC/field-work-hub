#!/usr/bin/env python3
"""Trusted-main, fail-closed publisher for explicitly marked FWH UI TEST builds.

This script runs ONLY from the repository's default-branch workflow_run job.
It never checks out, imports, or executes PR code. The APK is taken exclusively
from a successful GitHub Actions artifact and reverified before publication.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

REPO = "timbone72-CC/field-work-hub"
BRANCH = "feat/phase-5-6-dashboard-workflow"
PR_NUMBER = 40
NAMES = {
    "Android Team Client CI",
    "Admin Dashboard Gate CI",
    "FWH Database Gate CI",
}
PACKAGE = "com.inandout.fieldphotoprep.team.internal"
SIGNER = "1bbff192f97a8a24c6f812d77df6847eb9759b3afb3c4b210d9e6c251f4eecfe"
ASSET = "Field-Work-Hub-Internal.apk"
VERSION_TAG = re.compile(r"^fwh-internal-v([1-9][0-9]{0,7})$")
READY_MARK = re.compile(r"(?m)^FWH-UI-TEST-READY: ([1-9][0-9]{0,7})$")
SHA = re.compile(r"^[0-9a-f]{40}$")
ALLOWED_FILES = {
    "app/build.gradle",
    "ci/write_phase5_artifact_identity.py",
    "app/src/main/java/com/inandout/fieldphotoprep/team/internal/MainActivity.java",
    "app/src/main/java/com/inandout/fieldphotoprep/team/internal/PhotoActivity.java",
    "app/src/main/java/com/inandout/fieldphotoprep/team/internal/PhotoRecoveryActivity.java",
    "app/src/main/java/com/inandout/fieldphotoprep/team/internal/FwhVisualStyle.java",
    "app/src/main/java/com/inandout/fieldphotoprep/team/internal/UpdateCheckCadence.java",
    "docs/PHASE_5_6_IMPLEMENTATION_RECORD_2026-10-06.md",
    "docs/FWH_INTERNAL_AUTO_UPDATE_PLAN_2026-10-16.md",
}
TEST_PREFIX = "app/src/test/java/com/inandout/fieldphotoprep/team/internal/"


class NotEligible(Exception):
    """A build must not be published; no elevated action is performed."""


def require(condition, reason):
    if not condition:
        raise NotEligible(reason)


def allowed_path(path):
    return path in ALLOWED_FILES or (
        path.startswith(TEST_PREFIX)
        and path.endswith("Test.java")
        and "/" not in path[len(TEST_PREFIX):]
    )


def marked_version(message):
    marks = READY_MARK.findall(message)
    require(len(marks) == 1, "No unique final-commit UI test readiness marker")
    version = int(marks[0])
    require(version >= 30 and version % 2 == 0, "Invalid UI candidate version")
    return version


def validate_ci(runs, sha):
    # The most recent attempt governs. Never reuse an older PASS when a newer
    # run on the same SHA has failed, been cancelled or is still pending.
    latest = {}
    for run in runs:
        name = run.get("name")
        if name not in NAMES or run.get("head_sha") != sha:
            continue
        if run.get("event") != "pull_request" or run.get("head_branch") != BRANCH:
            continue
        if (run.get("head_repository") or {}).get("full_name") != REPO:
            continue
        if name not in latest or (int(run.get("id", 0)), int(run.get("run_attempt", 1))) > (
                int(latest[name].get("id", 0)), int(latest[name].get("run_attempt", 1))):
            latest[name] = run
    require(set(latest) == NAMES, "All three exact-source PR CI gates are required")
    for name, run in latest.items():
        require(run.get("status") == "completed" and run.get("conclusion") == "success",
                "Newest " + name + " is not successful")
    return latest["Android Team Client CI"]["id"]


def validate_diff(comparison):
    require(comparison.get("status") == "ahead" and comparison.get("ahead_by", 0) > 0,
            "Candidate does not descend from latest published release")
    files = comparison.get("files", [])
    require(0 < len(files) < 300, "Missing/truncated candidate diff")
    names = [item["filename"] for item in files]
    rejected = [p for p in names if not allowed_path(p)]
    require(not rejected, "Non-UI or protected files changed: " + ", ".join(rejected[:8]))
    require("app/src/main/java/com/inandout/fieldphotoprep/team/internal/MainActivity.java" in names
            or "app/src/main/java/com/inandout/fieldphotoprep/team/internal/PhotoActivity.java" in names
            or "app/src/main/java/com/inandout/fieldphotoprep/team/internal/PhotoRecoveryActivity.java" in names,
            "No approved Android UI implementation change")
    return names


def validate_metadata(meta, apk, sha, version):
    require(meta.get("source_commit") == sha, "Frozen APK does not match tested SHA")
    require(meta.get("package") == PACKAGE, "Unexpected package")
    require(meta.get("room_version") == 5, "Room schema changed")
    require(meta.get("signer_sha256") == SIGNER, "Unexpected test signer")
    require(meta.get("version_code") == version, "APK version does not match readiness marker")
    require(apk.name == ASSET and apk.is_file(), "Expected one internal APK")
    require(100_000 <= apk.stat().st_size <= 64 * 1024 * 1024, "Invalid APK size")
    digest = hashlib.sha256(apk.read_bytes()).hexdigest()
    require(digest == meta.get("sha256"), "APK SHA-256 does not match CI frozen metadata")
    return digest


def api(path, *, allow404=False):
    token = os.environ["GH_TOKEN"]
    request = urllib.request.Request(
        "https://api.github.com/repos/" + REPO + "/" + path,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": "Bearer " + token,
            "User-Agent": "FWH-trusted-UI-TEST-publisher",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if allow404 and error.code == 404:
            return None
        raise


def check_head(sha):
    pr = api(f"pulls/{PR_NUMBER}")
    require(pr.get("state") == "open", "Approved UI implementation PR is not open")
    require(pr.get("head", {}).get("ref") == BRANCH, "Wrong UI preview branch")
    require(pr.get("head", {}).get("repo", {}).get("full_name") == REPO,
            "Refuse fork-supplied APK")
    require(pr.get("base", {}).get("ref") == "main", "Unexpected integration target")
    require(pr.get("head", {}).get("sha") == sha, "The candidate is no longer the PR head")


def check_gates(sha):
    runs = api("actions/runs?head_sha=" + sha + "&per_page=100").get("workflow_runs", [])
    require(len(runs) < 100, "CI pagination uncertain; refuse publication")
    return validate_ci(runs, sha)


def check_previous_release(version, sha):
    latest = api("releases/latest", allow404=True)
    require(latest is not None, "No preexisting internal release baseline")
    tag = latest.get("tag_name", "")
    match = VERSION_TAG.fullmatch(tag)
    require(match is not None, "Latest release is not a governed internal version")
    prior = int(match.group(1))
    require(version > prior, "The candidate is not newer than the latest release")
    require(latest.get("draft") is False and latest.get("prerelease") is False,
            "Latest release cannot be trusted as public baseline")
    origin = latest.get("target_commitish", "")
    require(bool(SHA.fullmatch(origin)) and origin != sha,
            "Latest release has no immutable source commit")
    candidate_tag = f"fwh-internal-v{version}"
    require(api("releases/tags/" + candidate_tag, allow404=True) is None,
            "Version already exists; releases may never be overwritten")
    comparison = api("compare/" + origin + "..." + sha)
    validate_diff(comparison)
    return candidate_tag


def main():
    if os.environ.get("FWH_UI_AUTO_RELEASE_ENABLED", "false") != "true":
        print("SKIP: FWH UI TEST auto-publication kill switch is not enabled")
        return 0

    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    trigger = event.get("workflow_run", {})
    if (trigger.get("event") != "pull_request"
            or trigger.get("head_branch") != BRANCH
            or trigger.get("head_repository", {}).get("full_name") != REPO
            or trigger.get("status") != "completed"
            or trigger.get("conclusion") != "success"):
        print("SKIP: not a successful UI-branch pull-request CI completion")
        return 0

    sha = trigger.get("head_sha", "")
    require(bool(SHA.fullmatch(sha)), "Invalid triggering commit SHA")
    check_head(sha)
    commit = api("commits/" + sha)
    version = marked_version(commit["commit"]["message"])
    run_id = check_gates(sha)
    tag = check_previous_release(version, sha)

    with tempfile.TemporaryDirectory() as temp:
        subprocess.run(
            ["gh", "run", "download", str(run_id), "--repo", REPO,
             "--name", "field-work-hub-internal-direct-release", "--dir", temp],
            check=True,
        )
        root = Path(temp)
        files = sorted(path.name for path in root.iterdir())
        require(files == [ASSET, "internal-release-metadata.json"],
                "Unexpected direct-release artifact inventory")
        apk = root / ASSET
        meta = json.loads((root / "internal-release-metadata.json").read_text())
        digest = validate_metadata(meta, apk, sha, version)

        # Recheck the trusted sources immediately before the external side effect.
        check_head(sha)
        require(check_gates(sha) == run_id, "Verified Android CI run changed")
        check_previous_release(version, sha)
        print(f"Publishing verified, operator-opted-in TEST {tag} / {sha} / sha256:{digest}")
        subprocess.run(
            ["gh", "release", "create", tag, str(apk), "--repo", REPO,
             "--target", sha, "--title", f"Field Work Hub Internal {tag} (TEST)",
             "--notes", ("Automatically published, verified public INTERNAL TEST APK. "
                         f"Source {sha}. SHA-256 {digest}. "
                         "Android installation confirmation remains required. "
                         "Never uninstall or clear saved jobs/photos.")],
            check=True,
        )
        result = api("releases/tags/" + tag)
        assets = result.get("assets", [])
        if not (result.get("target_commitish") == sha and len(assets) == 1
                and assets[0].get("name") == ASSET
                and assets[0].get("digest") == "sha256:" + digest):
            raise RuntimeError("Public release identity could not be reconciled: STOP")
        print(f"PUBLISHED {tag}, exact artifact digest confirmed")

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except NotEligible as error:
        print(f"SKIP: {error}")
        sys.exit(0)
