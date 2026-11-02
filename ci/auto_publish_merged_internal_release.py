#!/usr/bin/env python3
"""Trusted-main publisher: approved release-only merge -> verified internal APK.

Runs only in the repository's default-branch workflow_run job. Never checks out
PR code, executes PR commands or publishes unmerged/test-recovery APKs.
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
CI_NAMES = {"Android Team Client CI", "FWH Database Gate CI", "Admin Dashboard Gate CI"}
PACKAGE = "com.inandout.fieldphotoprep.team.internal"
SIGNER = "1bbff192f97a8a24c6f812d77df6847eb9759b3afb3c4b210d9e6c251f4eecfe"
APK_NAME = "Field-Work-Hub-Internal.apk"
SHA = re.compile(r"^[0-9a-f]{40}$")
VERSION_TAG = re.compile(r"^fwh-internal-v([1-9][0-9]*)$")
RELEASE_BRANCH = re.compile(r"^release/fwh-internal-v([1-9][0-9]*)-[a-z0-9][a-z0-9-]{0,70}$")
RELEASE_RECORD = re.compile(
    r"^docs/FWH_INTERNAL_V([1-9][0-9]*)_POSTMERGE_RELEASE_RECORD_[0-9]{4}-[0-9]{2}-[0-9]{2}\.md$"
)
VERSION_FILES = {"app/build.gradle", "ci/write_phase5_artifact_identity.py"}


class NotEligible(Exception):
    """Do not publish; no elevated side effect is authorized."""


def require(test, reason):
    if not test:
        raise NotEligible(reason)


def api(path, *, allow404=False):
    request = urllib.request.Request(
        "https://api.github.com/repos/" + REPO + "/" + path,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": "Bearer " + os.environ["GH_TOKEN"],
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "FWH-trusted-merged-internal-publisher",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if allow404 and error.code == 404:
            return None
        raise


def unique_pr_field(body, name):
    matches = re.findall(
        r"(?mi)^\s*-\s*" + re.escape(name) + r"\s*:\s*([^\r\n]*)$",
        body,
    )
    require(len(matches) == 1, "Missing or duplicated release authority: " + name)
    return matches[0].strip()


def release_pr_for_merged_head(sha):
    require(SHA.fullmatch(sha), "Invalid merge SHA")
    require(api("commits/main").get("sha") == sha, "Main advanced; no stale APK publish")
    commit = api("commits/" + sha)
    parents = commit.get("parents") or []
    require(len(parents) == 2 and all(SHA.fullmatch(p.get("sha", "")) for p in parents),
            "Only an ordinary two-parent, reviewed release-PR merge may publish")
    pulls = api("commits/" + sha + "/pulls")
    require(isinstance(pulls, list) and len(pulls) == 1,
            "Merge has no unique associated PR")
    pr = pulls[0]
    head = pr.get("head") or {}
    base = pr.get("base") or {}
    branch = head.get("ref", "")
    match = RELEASE_BRANCH.fullmatch(branch)
    require(match is not None, "Not a designated internal Android release branch")
    require(pr.get("merged_at") and pr.get("merge_commit_sha") == sha,
            "Release PR is not the exact merged commit")
    require(head.get("sha") == parents[1]["sha"], "Merged PR head changed")
    require((head.get("repo") or {}).get("full_name") == REPO,
            "Fork-controlled APK not permitted")
    require(base.get("ref") == "main", "Release PR targeted another branch")
    body = pr.get("body") or ""
    require(unique_pr_field(body, "Change level") == "Level 3",
            "Internal APK release requires Level 3 governance")
    require(unique_pr_field(body, "Level 3 merge approval") == "APPROVED",
            "Explicit operator pre-merge approval absent")
    require(unique_pr_field(body, "Internal TEST APK publication") == "APPROVED",
            "No explicit approved public TEST APK publication")
    version_text = unique_pr_field(body, "Internal TEST APK version")
    require(version_text.isdecimal(), "Release version must be decimal")
    version = int(version_text)
    require(version >= 38 and version % 2 == 0 and version == int(match.group(1)),
            "Release version is not the approved even branch version")
    return parents[0]["sha"], branch, version


def validate_ci(runs, sha):
    # A new failed/in-progress run overrides an older PASS for the same suite.
    latest = {}
    for r in runs:
        if r.get("name") not in CI_NAMES or r.get("head_sha") != sha:
            continue
        if r.get("event") != "push" or r.get("head_branch") != "main":
            continue
        if (r.get("head_repository") or {}).get("full_name") != REPO:
            continue
        key = r["name"]
        rank = (int(r.get("id", 0)), int(r.get("run_attempt", 1)))
        old = latest.get(key)
        if old is None or rank > (int(old.get("id", 0)), int(old.get("run_attempt", 1))):
            latest[key] = r
    require(set(latest) == CI_NAMES, "Three exact-main-commit CI suites required")
    require(all(r.get("status") == "completed" and r.get("conclusion") == "success"
                for r in latest.values()), "Newest required CI attempt not successful")
    return latest["Android Team Client CI"]["id"]


def check_gates(sha):
    runs = api("actions/runs?head_sha=" + sha + "&per_page=100").get("workflow_runs", [])
    require(len(runs) < 100, "CI pagination uncertain")
    return validate_ci(runs, sha)


def check_release_only_diff(parent, sha, version):
    comparison = api("compare/" + parent + "..." + sha)
    require(comparison.get("status") == "ahead" and comparison.get("behind_by") == 0
            and comparison.get("ahead_by", 0) > 0, "Not an additive release merge")
    files = comparison.get("files") or []
    require(2 <= len(files) <= 10, "Release-only merge file list is missing/truncated")
    names = {f.get("filename", "") for f in files}
    require(VERSION_FILES.issubset(names), "Missing version/signature metadata change")
    docs = [n for n in names if n not in VERSION_FILES]
    require(len(docs) <= 1 and all(
        RELEASE_RECORD.fullmatch(n) and int(RELEASE_RECORD.fullmatch(n).group(1)) == version
        for n in docs), "Release-only merge contains non-version or protected code")
    require(all(f.get("status") in {"modified", "added"} for f in files),
            "Release merge cannot delete or rename protected files")
    return names


def check_previous_release(version, parent, sha):
    latest = api("releases/latest", allow404=True)
    require(latest is not None, "No trusted published APK baseline")
    match = VERSION_TAG.fullmatch(latest.get("tag_name", ""))
    require(match is not None and version > int(match.group(1)),
            "Version must exceed the latest immutable APK release")
    require(latest.get("draft") is False and latest.get("prerelease") is False,
            "Latest release is not a verified public baseline")
    origin = latest.get("target_commitish", "")
    require(SHA.fullmatch(origin) and origin != sha,
            "Prior APK lacks a distinct immutable source commit")
    require(api("releases/tags/fwh-internal-v" + str(version), allow404=True) is None,
            "Release tag already exists: never replace an APK")
    ancestry = api("compare/" + origin + "..." + parent)
    require(ancestry.get("status") in {"ahead", "identical"}
            and ancestry.get("behind_by") == 0,
            "Merged source does not descend from previous published version")
    return "fwh-internal-v" + str(version)


def verify_artifact(meta, apk, sha, version):
    require(meta.get("source_commit") == sha, "Frozen APK source SHA mismatch")
    require(meta.get("package") == PACKAGE, "Wrong Android package")
    require(meta.get("version_code") == version, "Wrong APK version")
    require(meta.get("room_version") == 5, "Room schema unexpectedly changed")
    require(meta.get("signer_sha256") == SIGNER, "Wrong stable internal signer")
    require(apk.name == APK_NAME and apk.is_file(), "Expected one internal APK")
    require(100_000 <= apk.stat().st_size <= 64 * 1024 * 1024,
            "Unexpected APK size")
    digest = hashlib.sha256(apk.read_bytes()).hexdigest()
    require(meta.get("sha256") == digest, "Frozen APK digest mismatch")
    return digest


def main():
    if os.environ.get("FWH_UI_AUTO_RELEASE_ENABLED", "false") != "true":
        print("SKIP: internal TEST publication switch is disabled")
        return 0
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    run = event.get("workflow_run") or {}
    if (run.get("event") != "push" or run.get("head_branch") != "main"
            or (run.get("head_repository") or {}).get("full_name") != REPO
            or run.get("status") != "completed" or run.get("conclusion") != "success"
            or run.get("name") not in CI_NAMES):
        print("SKIP: not a successful trusted main-push CI completion")
        return 0
    sha = run.get("head_sha", "")
    require(SHA.fullmatch(sha), "Invalid triggering commit")
    parent, branch, version = release_pr_for_merged_head(sha)
    check_release_only_diff(parent, sha, version)
    run_id = check_gates(sha)
    tag = check_previous_release(version, parent, sha)

    with tempfile.TemporaryDirectory() as temp:
        subprocess.run(
            ["gh", "run", "download", str(run_id), "--repo", REPO,
             "--name", "field-work-hub-internal-direct-release", "--dir", temp],
            check=True,
        )
        root = Path(temp)
        require(sorted(x.name for x in root.iterdir()) ==
                [APK_NAME, "internal-release-metadata.json"],
                "Unexpected release artifact inventory")
        apk = root / APK_NAME
        meta = json.loads((root / "internal-release-metadata.json").read_text())
        digest = verify_artifact(meta, apk, sha, version)

        # Recheck all mutable sources just before the public write.
        require(release_pr_for_merged_head(sha) == (parent, branch, version),
                "Release authorization changed")
        check_release_only_diff(parent, sha, version)
        require(check_gates(sha) == run_id, "CI changed after artifact verification")
        require(check_previous_release(version, parent, sha) == tag,
                "Published baseline changed")
        subprocess.run([
            "gh", "release", "create", tag, str(apk), "--repo", REPO,
            "--target", sha,
            "--title", "Field Work Hub Internal " + tag + " (TEST)",
            "--notes", ("Verified, operator-approved public INTERNAL TEST APK. "
                        f"Source {sha}. SHA-256 {digest}. "
                        "Android installer confirmation required. "
                        "Never uninstall or clear stored jobs/photos."),
        ], check=True)
        published = api("releases/tags/" + tag)
        assets = published.get("assets", [])
        if not (published.get("target_commitish") == sha and len(assets) == 1
                and assets[0].get("name") == APK_NAME
                and assets[0].get("digest") == "sha256:" + digest):
            raise RuntimeError("Published artifact identity uncertain; STOP")
        print("PUBLISHED and verified", tag, sha, digest)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except NotEligible as error:
        print("SKIP:", error)
        sys.exit(0)
