"""Verify a public-link candidate has identical bytes to CI-frozen signed Team APK."""
import hashlib
import json
import pathlib
import sys

identity_file = pathlib.Path(sys.argv[1])
apk = pathlib.Path(sys.argv[2])
identity = json.loads(identity_file.read_text(encoding="utf-8"))
release = json.loads((apk.parent / "internal-release-metadata.json").read_text(encoding="utf-8"))
digest = hashlib.sha256(apk.read_bytes()).hexdigest()
assert apk.name == "Field-Work-Hub-Internal.apk"
assert identity["variant"] == "candidate"
assert identity["package"] == "com.inandout.fieldphotoprep.team.internal"
assert identity["version_code"] >= 22 and identity["version_code"] % 2 == 0
assert identity["room_version"] == 5
assert identity["field_sync_enabled"] is True
assert identity["automatic_cleanup_enabled"] is False
assert identity["signer_sha256"] == "1bbff192f97a8a24c6f812d77df6847eb9759b3afb3c4b210d9e6c251f4eecfe"
assert identity["sha256"] == digest
for field, expected in (
    ("source_commit", identity["runtime_head"]),
    ("package", identity["package"]),
    ("version_code", identity["version_code"]),
    ("signer_sha256", identity["signer_sha256"]),
    ("sha256", digest),
    ("room_version", identity["room_version"]),
):
    assert release[field] == expected, field
print("Verified byte-identical standalone internal APK:", digest)
print("Expected release tag:", f"fwh-internal-v{identity['version_code']}")
print("NOT PUBLISHED: CI artifact only; manual public-release decision remains gated.")
