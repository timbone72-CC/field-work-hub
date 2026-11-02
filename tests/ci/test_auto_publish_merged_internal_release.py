"""Offline security and release-identity regressions for trusted postmerge APK publisher."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / "ci/auto_publish_merged_internal_release.py"
spec = importlib.util.spec_from_file_location("fwh_merged_release", SCRIPT)
pub = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pub)

MERGE = "a" * 40
PARENT = "b" * 40
HEAD = "c" * 40
OLD = "d" * 40
BRANCH = "release/fwh-internal-v38-merged-field-test"
PR_BODY = """
- Change level: Level 3
- Level 3 merge approval: APPROVED
- Internal TEST APK publication: APPROVED
- Internal TEST APK version: 38
"""


def merged_pr(body=PR_BODY, branch=BRANCH, merged=True):
    return {
        "merged_at": "2026-11-02T00:00:00Z" if merged else None,
        "merge_commit_sha": MERGE, "body": body,
        "head": {"ref": branch, "sha": HEAD, "repo": {"full_name": pub.REPO}},
        "base": {"ref": "main"},
    }


def fake_api(path, **_):
    if path == "commits/main":
        return {"sha": MERGE}
    if path == "commits/" + MERGE:
        return {"parents": [{"sha": PARENT}, {"sha": HEAD}]}
    if path == "commits/" + MERGE + "/pulls":
        return [merged_pr()]
    raise AssertionError("Unexpected network call: " + path)


def ci_run(name, status="completed", conclusion="success", event="push",
           branch="main", sha=MERGE, run_id=100):
    return dict(name=name, status=status, conclusion=conclusion, event=event,
                head_branch=branch, head_sha=sha, id=run_id,
                head_repository={"full_name": pub.REPO})


class MergedInternalReleaseTests(unittest.TestCase):
    def test_merged_release_requires_explicit_operator_and_publish_approval(self):
        with patch.object(pub, "api", fake_api):
            self.assertEqual((PARENT, BRANCH, 38), pub.release_pr_for_merged_head(MERGE))
        bad_bodies = [
            PR_BODY.replace("APPROVED", "PENDING", 1),
            PR_BODY.replace("Internal TEST APK publication: APPROVED",
                            "Internal TEST APK publication: PENDING"),
            PR_BODY.replace("Internal TEST APK version: 38",
                            "Internal TEST APK version: 40"),
            PR_BODY + "- Internal TEST APK publication: APPROVED\n",
            PR_BODY.replace("Change level: Level 3", "Change level: Level 2"),
        ]
        for body in bad_bodies:
            def bad_api(path, **kw):
                return [merged_pr(body=body)] if path.endswith("/pulls") else fake_api(path, **kw)
            with self.subTest(body=body), patch.object(pub, "api", bad_api):
                with self.assertRaises(pub.NotEligible):
                    pub.release_pr_for_merged_head(MERGE)

    def test_refuse_wrong_source_branch_fork_stale_head_or_nonmerge(self):
        scenarios = [
            lambda x: x.update(merge_commit_sha=HEAD),
            lambda x: x.update(merged_at=None),
            lambda x: x["head"].update(ref="feat/unauthorized"),
            lambda x: x["head"].update(sha=PARENT),
            lambda x: x["head"]["repo"].update(full_name="somebody/fork"),
            lambda x: x["base"].update(ref="other"),
        ]
        for change in scenarios:
            pr = merged_pr()
            change(pr)
            def bad_api(path, **kw):
                return [pr] if path.endswith("/pulls") else fake_api(path, **kw)
            with patch.object(pub, "api", bad_api), self.assertRaises(pub.NotEligible):
                pub.release_pr_for_merged_head(MERGE)
        with patch.object(pub, "api", lambda p, **kw: (
                {"sha": HEAD} if p == "commits/main" else fake_api(p, **kw))):
            with self.assertRaises(pub.NotEligible):
                pub.release_pr_for_merged_head(MERGE)

    def test_three_exact_main_push_suite_success_required(self):
        runs = [ci_run(n, run_id=100 + i) for i, n in enumerate(sorted(pub.CI_NAMES))]
        self.assertIsInstance(pub.validate_ci(runs, MERGE), int)
        for n in pub.CI_NAMES:
            with self.subTest(missing=n), self.assertRaises(pub.NotEligible):
                pub.validate_ci([r for r in runs if r["name"] != n], MERGE)
            with self.subTest(failed=n), self.assertRaises(pub.NotEligible):
                pub.validate_ci([ci_run(v, conclusion="failure" if v == n else "success")
                                 for v in pub.CI_NAMES], MERGE)
        for kw in [{"event": "pull_request"}, {"sha": PARENT},
                   {"branch": "release/fwh-internal-v38-merged-field-test"}]:
            with self.assertRaises(pub.NotEligible):
                pub.validate_ci([ci_run(n, **kw) for n in pub.CI_NAMES], MERGE)
        newer = ci_run("Android Team Client CI", status="in_progress",
                       conclusion=None, run_id=1000)
        with self.assertRaises(pub.NotEligible):
            pub.validate_ci(runs + [newer], MERGE)

    def test_diff_is_release_only_and_never_provider_or_protected_photos(self):
        files = [{"filename": "app/build.gradle", "status": "modified"},
                 {"filename": "ci/write_phase5_artifact_identity.py", "status": "modified"},
                 {"filename": "docs/FWH_INTERNAL_V38_POSTMERGE_RELEASE_RECORD_2026-11-02.md",
                  "status": "added"}]
        def comparison(extra=None, status="ahead", behind=0):
            return {"status": status, "ahead_by": 1, "behind_by": behind,
                    "files": files + (extra or [])}
        with patch.object(pub, "api", return_value=comparison()):
            self.assertEqual(3, len(pub.check_release_only_diff(PARENT, MERGE, 38)))
        for bad in ["supabase/migrations/123.sql",
                    "app/src/main/java/com/inandout/fieldphotoprep/team/internal/PhotoOwner.java",
                    "app/src/main/java/com/inandout/fieldphotoprep/team/internal/TeamDatabase.java",
                    ".github/workflows/android-ci.yml",
                    "app/src/main/AndroidManifest.xml", "dashboard/index.html",
                    "ci/auto_publish_merged_internal_release.py",
                    "docs/FWH_INTERNAL_V40_POSTMERGE_RELEASE_RECORD_2026-11-02.md"]:
            with self.subTest(path=bad), patch.object(
                    pub, "api", return_value=comparison([{"filename": bad, "status": "added"}])):
                with self.assertRaises(pub.NotEligible):
                    pub.check_release_only_diff(PARENT, MERGE, 38)
        for faulty in [comparison(status="diverged"), comparison(behind=1),
                       {"status": "ahead", "ahead_by": 1, "behind_by": 0,
                        "files": files[:1]}]:
            with patch.object(pub, "api", return_value=faulty), self.assertRaises(pub.NotEligible):
                pub.check_release_only_diff(PARENT, MERGE, 38)

    def test_prior_release_monotonic_immutable_and_ancestor(self):
        latest = {"tag_name": "fwh-internal-v36", "draft": False,
                  "prerelease": False, "target_commitish": OLD}
        def gate(path, **_):
            if path == "releases/latest":
                return latest
            if path == "releases/tags/fwh-internal-v38":
                return None
            if path == "compare/" + OLD + "..." + PARENT:
                return {"status": "ahead", "behind_by": 0}
            raise AssertionError(path)
        with patch.object(pub, "api", gate):
            self.assertEqual("fwh-internal-v38",
                             pub.check_previous_release(38, PARENT, MERGE))
            with self.assertRaises(pub.NotEligible):
                pub.check_previous_release(36, PARENT, MERGE)
        with patch.object(pub, "api", lambda p, **kw: (
                {"status": "diverged", "behind_by": 1}
                if p.startswith("compare/") else gate(p, **kw))):
            with self.assertRaises(pub.NotEligible):
                pub.check_previous_release(38, PARENT, MERGE)

    def test_frozen_apk_identity_and_hash_protected(self):
        with tempfile.TemporaryDirectory() as d:
            apk = Path(d) / pub.APK_NAME
            apk.write_bytes(b"APK" * 40_000)
            meta = {"source_commit": MERGE, "package": pub.PACKAGE,
                    "version_code": 38, "room_version": 5, "signer_sha256": pub.SIGNER,
                    "sha256": hashlib.sha256(apk.read_bytes()).hexdigest()}
            self.assertEqual(meta["sha256"], pub.verify_artifact(meta, apk, MERGE, 38))
            for k, value in [("source_commit", OLD), ("package", "fake.pkg"),
                             ("version_code", 36), ("room_version", 6),
                             ("signer_sha256", "fake"), ("sha256", "fake")]:
                with self.subTest(k=k), self.assertRaises(pub.NotEligible):
                    pub.verify_artifact({**meta, k: value}, apk, MERGE, 38)

    def test_privileged_workflow_only_runs_on_main_push_and_main_checkout(self):
        workflow = (Path(__file__).resolve().parents[2]
                    / ".github/workflows/internal-ui-test-auto-release.yml").read_text()
        self.assertIn("github.event.workflow_run.event == 'push'", workflow)
        self.assertIn("github.event.workflow_run.head_branch == 'main'", workflow)
        self.assertIn("github.event.workflow_run.head_repository.full_name", workflow)
        self.assertIn("ref: main", workflow)
        self.assertIn("cancel-in-progress: false", workflow)
        self.assertIn("ci/auto_publish_merged_internal_release.py", workflow)
        self.assertNotIn("gh release create", workflow)

    def test_kill_switch_denies_before_any_api_or_files(self):
        with patch.dict("os.environ", {"FWH_UI_AUTO_RELEASE_ENABLED": "false"}):
            with patch.object(pub, "api", side_effect=AssertionError("network forbidden")):
                self.assertEqual(0, pub.main())


if __name__ == "__main__":
    unittest.main()
