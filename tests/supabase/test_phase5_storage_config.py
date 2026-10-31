"""Fail closed on private-holding configuration drift before hosted provisioning.

This validates declarative configuration, not Supabase Storage or real bytes.
"""

import pathlib
import tomllib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONFIG = ROOT / "supabase" / "config.toml"


def validate(document):
    if set(document) != {"project_id", "db", "storage"}:
        raise ValueError("Unexpected CLI settings or external project binding")
    if document["project_id"] != "field-work-hub":
        raise ValueError("Local project label changed")
    if document["db"] != {"major_version": 17}:
        raise ValueError("Database version drift")
    if set(document["storage"]) != {"buckets"}:
        raise ValueError("Storage configuration changed")
    buckets = document["storage"]["buckets"]
    if set(buckets) != {"fwh-review-private"}:
        raise ValueError("Wrong or extra bucket")
    bucket = buckets["fwh-review-private"]
    if set(bucket) != {"public", "file_size_limit", "allowed_mime_types"}:
        raise ValueError("Unexpected bucket settings")
    if bucket["public"] is not False:
        raise ValueError("Private photos must not be public")
    if bucket["file_size_limit"] != "32MiB":
        raise ValueError("Bucket limit must match accepted derivative size ceiling")
    if bucket["allowed_mime_types"] != ["image/jpeg"]:
        raise ValueError("Bucket must accept only prepared JPEGs")


class PrivateHoldingConfigTests(unittest.TestCase):
    def test_declared_private_bucket(self):
        with CONFIG.open("rb") as source:
            validate(tomllib.load(source))

    def test_insecure_or_mismatched_config_fails_closed(self):
        with CONFIG.open("rb") as source:
            original = tomllib.load(source)
        for key, bad in (("public", True), ("file_size_limit", "50MiB"),
                         ("allowed_mime_types", ["image/*"])):
            data = {**original, "storage": {"buckets": {"fwh-review-private": {
                **original["storage"]["buckets"]["fwh-review-private"], key: bad}}}}
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate(data)


if __name__ == "__main__":
    unittest.main()
