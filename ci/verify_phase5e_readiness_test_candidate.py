#!/usr/bin/env python3
"""Freeze a PRIVATE CI artifact for explicitly opted-in FWH TEST polling.

This does not use the public APK publisher, release tag, or Android installer.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

EXPECTED = {
    "candidate": (42, True, True, "v42-test"),
    "recovery": (43, False, False, "v43-recovery"),
}
SIGNER = "1bbff192f97a8a24c6f812d77df6847eb9759b3afb3c4b210d9e6c251f4eecfe"
PROJECT = 'static final String PROJECT_URL = "https://vyocaujuwrivoqynvitm.supabase.co";'
PACKAGE = "com.inandout.fieldphotoprep.team.internal"


def verify(variant):
    if variant not in EXPECTED:
        raise SystemExit("Expected candidate or recovery")
    version, field_sync, readiness, name_fragment = EXPECTED[variant]
    source = Path("app/src/main/java/com/inandout/fieldphotoprep/team/internal/SupabaseConfig.java")
    assert PROJECT in source.read_text(encoding="utf-8"), "Wrong FWH TEST Supabase project"
    gradle = Path("app/build.gradle").read_text(encoding="utf-8")
    assert "buildConfigField 'boolean', 'AUTOMATIC_CLEANUP_ENABLED', 'false'" in gradle
    apk = Path("app/build/outputs/apk/debug/app-debug.apk")
    assert apk.is_file(), "Built APK missing"
    android_home = Path(os.environ["ANDROID_HOME"])
    versions = sorted((android_home / "build-tools").iterdir(),
                      key=lambda p: tuple(int(x) for x in re.findall(r"\d+", p.name)))
    tools = versions[-1]
    badging = subprocess.check_output([str(tools / "aapt"), "dump", "badging", str(apk)],
                                      text=True)
    certs = subprocess.check_output([str(tools / "apksigner"), "verify", "--print-certs",
                                     str(apk)], text=True)
    digest_match = re.search(r"certificate SHA-256 digest:\s*([0-9a-fA-F]+)", certs)
    assert digest_match and digest_match.group(1).lower() == SIGNER, "Wrong TEST signer"
    assert f"versionCode='{version}'" in badging, "Wrong monotonic TEST version"
    assert f"name='{PACKAGE}'" in badging, "Wrong package"
    assert name_fragment in badging, "Wrong TEST version name"
    generated = list(Path("app/build/generated").rglob("BuildConfig.java"))
    assert len(generated) == 1, "Ambiguous BuildConfig"
    config = generated[0].read_text(encoding="utf-8")
    for field, value in (
        ("FIELD_SYNC_ENABLED", field_sync),
        ("CLEANUP_READINESS_POLLING_ENABLED", readiness),
        ("AUTOMATIC_CLEANUP_ENABLED", False),
    ):
        expected = f"{field} = {str(value).lower()}"
        assert expected in config, f"BuildConfig mismatch: {expected}"
    room = Path("app/src/main/java/com/inandout/fieldphotoprep/team/internal/TeamDatabase.java")
    assert "version = 6," in room.read_text(encoding="utf-8"), "Room6 lineage changed"
    for version_number in range(1, 7):
        schema = Path("app/schemas/com.inandout.fieldphotoprep.team.internal.TeamDatabase") / (
            str(version_number) + ".json")
        assert json.loads(schema.read_text(encoding="utf-8"))["database"]["version"] == version_number
    out = Path("phase5-artifacts") / ("readiness-test-" + variant)
    out.mkdir(parents=True, exist_ok=True)
    filename = f"Field-Work-Hub-Readiness-v{version}-{variant}-TEST.apk"
    shutil.copyfile(apk, out / filename)
    report = {
        "variant": variant,
        "source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"],
                                                  text=True).strip(),
        "package": PACKAGE,
        "version_code": version,
        "version_name_fragment": name_fragment,
        "room_version": 6,
        "signer_sha256": SIGNER,
        "sha256": hashlib.sha256(apk.read_bytes()).hexdigest(),
        "field_sync_enabled": field_sync,
        "cleanup_readiness_polling_enabled": readiness,
        "automatic_cleanup_enabled": False,
        "test_project_url": "https://vyocaujuwrivoqynvitm.supabase.co",
        "published": False,
        "installed": False,
    }
    (out / "identity.json").write_text(json.dumps(report, indent=2) + "\n",
                                       encoding="utf-8")
    print(json.dumps(report, indent=2))
    print("PRIVATE CI ARTIFACT ONLY — NOT PUBLISHED OR INSTALLED")


if __name__ == "__main__":
    verify(sys.argv[1] if len(sys.argv) == 2 else "")
