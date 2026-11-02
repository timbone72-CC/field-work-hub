#!/usr/bin/env python3
"""Limit the active FWH Phase 5/6 handoff, not its historical archives."""

from pathlib import Path

ACTIVE_RECORD = Path("docs/PHASE_5_6_IMPLEMENTATION_RECORD_2026-10-06.md")
MAX_BYTES = 24 * 1024


def check_record(path: Path = ACTIVE_RECORD) -> tuple[bool, str]:
    """Return a clear CI result without changing the record or archives."""
    try:
        contents = path.read_bytes()
        contents.decode("utf-8")
    except (OSError, UnicodeError) as exc:
        return False, f"FAIL: active Phase 5/6 record is missing, unreadable or not UTF-8: {path} ({exc})"

    size = len(contents)
    if size > MAX_BYTES:
        return False, (
            f"FAIL: active Phase 5/6 record is {size} bytes; the 24 KiB "
            f"({MAX_BYTES} bytes) limit was exceeded. Archive older historical "
            "evidence without deleting it, then update the active handoff."
        )
    return True, f"PASS: active Phase 5/6 record is {size}/{MAX_BYTES} UTF-8 bytes."


if __name__ == "__main__":
    passed, message = check_record()
    print(message)
    raise SystemExit(0 if passed else 1)
