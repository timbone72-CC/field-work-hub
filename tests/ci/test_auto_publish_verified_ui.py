"""Pure, offline policy proofs for the privileged UI TEST publisher."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / "ci/auto_publish_verified_ui.py"
spec = importlib.util.spec_from_file_location("fwh_ui_publisher", SCRIPT)
pub = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pub)
SHA = "a" * 40
BRANCH = pub.BRANCH


def run(name, conclusion="success", event="pull_request", sha=SHA, branch=BRANCH):
    return dict(
        name=name, conclusion=conclusion, status="completed", event=event,
        head_sha=sha, head_branch=branch, head_repository=dict(full_name=pub.REPO),
        id=100 + sorted(pub.NAMES).index(name),
    )


def valid_comparison(extra=None):
    files = [
        dict(filename="app/src/main/java/com/inandout/fieldphotoprep/team/internal/MainActivity.java"),
        dict(filename="app/build.gradle"),
        dict(filename="ci/write_phase5_artifact_identity.py"),
        dict(filename="docs/PHASE_5_6_IMPLEMENTATION_RECORD_2026-10-06.md"),
    ]
    if extra:
        files.append(dict(filename=extra))
    return dict(status="ahead", ahead_by=3, files=files)


class AutoPublisherPolicyTests(unittest.TestCase):
    def test_ready_requires_single_final_commit_trailer_and_even_new_version(self):
        self.assertEqual(30, pub.marked_version("style checkpoint\n\nFWH-UI-TEST-READY: 30"))
        for text in [
            "style checkpoint", "FWH-UI-TEST-READY: 29",
            "FWH-UI-TEST-READY: 28",
            "FWH-UI-TEST-READY: 30\nFWH-UI-TEST-READY: 32",
            "FWH-UI-TEST-READY: banana",
        ]:
            with self.subTest(text=text), self.assertRaises(pub.NotEligible):
                pub.marked_version(text)

    def test_ci_gates_are_exact_head_repo_branch_event_and_all_three_success(self):
        good = [run(n) for n in pub.NAMES]
        self.assertIsInstance(pub.validate_ci(good, SHA), int)
        for name in pub.NAMES:
            with self.subTest(missing=name), self.assertRaises(pub.NotEligible):
                pub.validate_ci([x for x in good if x["name"] != name], SHA)
            with self.subTest(failed=name), self.assertRaises(pub.NotEligible):
                pub.validate_ci([run(n, "failure" if n == name else "success")
                                 for n in pub.NAMES], SHA)
        with self.assertRaises(pub.NotEligible):
            pub.validate_ci([run(n, event="push") for n in pub.NAMES], SHA)
        with self.assertRaises(pub.NotEligible):
            pub.validate_ci([run(n, sha="b" * 40) for n in pub.NAMES], SHA)
        with self.assertRaises(pub.NotEligible):
            pub.validate_ci([run(n, branch="feat/fake") for n in pub.NAMES], SHA)
        older = [run(n) for n in pub.NAMES]
        newer_failure = run("Android Team Client CI", conclusion="failure")
        newer_failure["id"] = 1000
        with self.assertRaises(pub.NotEligible):
            pub.validate_ci(older + [newer_failure], SHA)
        newer_pending = run("Android Team Client CI")
        newer_pending.update(id=1001, status="in_progress", conclusion=None)
        with self.assertRaises(pub.NotEligible):
            pub.validate_ci(older + [newer_pending], SHA)

    def test_bounded_source_diff_refuses_high_risk_changes(self):
        self.assertIn("app/build.gradle", pub.validate_diff(valid_comparison()))
        for bad in [
            ".github/workflows/android-ci.yml",
            "app/src/main/java/com/inandout/fieldphotoprep/team/internal/PhotoOwner.java",
            "app/src/main/java/com/inandout/fieldphotoprep/team/internal/TeamDatabase.java",
            "app/src/main/java/com/inandout/fieldphotoprep/team/internal/AssignmentRepository.java",
            "supabase/migrations/20261016120000_change.sql",
            "ci/publish_internal_update.sh",
            "app/src/main/AndroidManifest.xml",
            "dashboard/app.js",
            "app/src/test/java/other/FakeTest.java",
        ]:
            with self.subTest(path=bad), self.assertRaises(pub.NotEligible):
                pub.validate_diff(valid_comparison(extra=bad))
        with self.assertRaises(pub.NotEligible):
            pub.validate_diff(dict(status="diverged", ahead_by=1, files=valid_comparison()["files"]))
        with self.assertRaises(pub.NotEligible):
            pub.validate_diff(dict(status="ahead", ahead_by=301,
                                   files=valid_comparison()["files"] * 300))
        with self.assertRaises(pub.NotEligible):
            pub.validate_diff(dict(status="ahead", ahead_by=1,
                                   files=[dict(filename="app/build.gradle")]))

    def test_frozen_release_bytes_and_identity_fail_closed(self):
        with tempfile.TemporaryDirectory() as d:
            apk = Path(d) / pub.ASSET
            apk.write_bytes(b"APK" * 40_000)
            meta = dict(source_commit=SHA, package=pub.PACKAGE, room_version=5,
                        signer_sha256=pub.SIGNER, version_code=30,
                        sha256=hashlib.sha256(apk.read_bytes()).hexdigest())
            self.assertEqual(meta["sha256"], pub.validate_metadata(meta, apk, SHA, 30))
            for key, bad in [
                ("package", "fake.package"), ("room_version", 6),
                ("version_code", 28), ("signer_sha256", "bad"), ("sha256", "bad"),
                ("source_commit", "b" * 40),
            ]:
                with self.subTest(key=key), self.assertRaises(pub.NotEligible):
                    pub.validate_metadata({**meta, key: bad}, apk, SHA, 30)

    def test_release_baseline_is_monotonic_and_tag_immutable(self):
        baseline = dict(tag_name="fwh-internal-v28", draft=False, prerelease=False,
                        target_commitish="b" * 40)
        def fake_api(path, allow404=False):
            if path == "releases/latest":
                return baseline
            if path == "releases/tags/fwh-internal-v30":
                return None
            if path == "compare/" + "b" * 40 + "..." + SHA:
                return valid_comparison()
            raise AssertionError(path)
        with patch.object(pub, "api", fake_api):
            self.assertEqual("fwh-internal-v30", pub.check_previous_release(30, SHA))
            with self.assertRaises(pub.NotEligible):
                pub.check_previous_release(28, SHA)
        with patch.object(pub, "api", lambda p, **k: {}):
            with self.assertRaises(pub.NotEligible):
                pub.check_previous_release(30, SHA)

    def test_kill_switch_keeps_publisher_off_without_api_or_files(self):
        with patch.dict("os.environ", {"FWH_UI_AUTO_RELEASE_ENABLED": "false"}):
            with patch.object(pub, "api", side_effect=AssertionError("network forbidden")):
                self.assertEqual(0, pub.main())


if __name__ == "__main__":
    unittest.main()
