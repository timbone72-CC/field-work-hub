"""Focused checks for the Phase 5/6 current-record size gate."""

import tempfile
import unittest
from pathlib import Path

from ci.check_phase56_record_size import MAX_BYTES, check_record


class RecordSizeGateTests(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory()
        self.addCleanup(self.workspace.cleanup)
        self.path = Path(self.workspace.name) / "active.md"

    def test_small_record_passes(self):
        self.path.write_bytes(b"# Current status\n")
        passed, message = check_record(self.path)
        self.assertTrue(passed, message)

    def test_exact_limit_passes(self):
        self.path.write_bytes(b"x" * MAX_BYTES)
        passed, message = check_record(self.path)
        self.assertTrue(passed, message)

    def test_one_byte_over_limit_fails(self):
        self.path.write_bytes(b"x" * (MAX_BYTES + 1))
        passed, message = check_record(self.path)
        self.assertFalse(passed)
        self.assertIn("Archive older historical evidence", message)

    def test_multibyte_unicode_uses_bytes_not_characters(self):
        self.path.write_text("é" * 12_300, encoding="utf-8")
        passed, message = check_record(self.path)
        self.assertFalse(passed)
        self.assertIn("24600 bytes", message)

    def test_missing_record_fails_closed(self):
        passed, message = check_record(self.path)
        self.assertFalse(passed)
        self.assertIn("missing", message)

    def test_invalid_utf8_fails_closed(self):
        self.path.write_bytes(bytes([255]))
        passed, message = check_record(self.path)
        self.assertFalse(passed)
        self.assertIn("not UTF-8", message)


if __name__ == "__main__":
    unittest.main()
