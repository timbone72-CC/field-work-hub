"""Exercise the actual governance workflow offline; no GitHub writes or device tests."""
import base64
import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import textwrap
import unittest
from unittest.mock import patch

WORKFLOW = Path(".github/workflows/governance-check.yml").read_text()
SOURCE = textwrap.dedent(WORKFLOW.split("python3 - <<'PY'\n", 1)[1].rsplit("\n          PY", 1)[0])
CODE = compile(SOURCE, "governance-check.yml", "exec")
BASE, HEAD = "a" * 40, "b" * 40
REPO = "owner/fwh"
BODY = """- Scope key: completion-check-example
- Goal: Finish approved feature
- Affected surfaces: Android
- Change level: Level 2
- Authoritative branch: example
- Required rule packs: GOVERNANCE.md
- Protected behavior: existing authority
- External systems changed: None
- Rollback point: baseline
- Verification boundary: focused CI
- Level 3 merge approval: N/A
- Construction task: 5E-T02
- Feature / milestone: FWH-F05 / FWH-AC2
- Work lane: FINISH
- Business outcome: Finish the normal guarded cleanup feature
- New physical/provider evidence: NONE

## Evidence / Remaining Gates
Verified prior evidence. Next: normal activation.
"""
def roadmap(first="ACTIVE", second="PLANNED", selected="5E-T02"):
    return ("## Completion-first V1 construction register — example\n"
            "- Primary subphase: **5E**\n"
            f"- Next construction task: **{selected}**\n"
            f"| **5E-T02** | FWH-F05 / FWH-AC2 | {first} | detail |\n"
            f"| **5E-T03** | FWH-F05 / FWH-AC2 | {second} | detail |\n")

class CompletionGovernance(unittest.TestCase):
    def check(self, line="return ownerId.equals(receipt.photoId);", body=BODY,
              filename="app/src/main/X.java", comments=(), after=None):
        event = {"pull_request": {"number": 123, "body": body, "draft": False,
                 "head": {"ref": "example", "sha": HEAD, "repo": {"full_name": REPO}},
                 "base": {"sha": BASE, "repo": {"owner": {"login": "owner"}}}}}
        def fake_api(request, timeout=30):
            url = request.full_url
            if "/pulls?state=open" in url:
                result = []
            elif "/pulls/123/files?" in url:
                result = [{"filename": filename, "status": "modified",
                           "additions": 1, "patch": "+" + line}]
            elif "/issues/123/comments?" in url:
                result = list(comments)
            elif "/contents/docs/ROADMAP.md?ref=" in url:
                document = after if url.endswith(HEAD) and after else roadmap()
                result = {"content": base64.b64encode(document.encode()).decode()}
            else:
                raise AssertionError(url)
            return io.BytesIO(json.dumps(result).encode())
        with tempfile.NamedTemporaryFile(mode="w") as payload:
            json.dump(event, payload)
            payload.flush()
            output = io.StringIO()
            with patch.dict(os.environ, {"GITHUB_EVENT_PATH": payload.name,
                            "GITHUB_TOKEN": "fake", "GITHUB_REPOSITORY": REPO}), \
                    patch("urllib.request.urlopen", fake_api), contextlib.redirect_stdout(output):
                try:
                    exec(CODE, {})
                    return True, output.getvalue()
                except SystemExit as exc:
                    self.assertEqual(exc.code, 1, output.getvalue())
                    return False, output.getvalue()

    def test_normal_and_fixture(self):
        self.assertTrue(self.check()[0])
        self.assertTrue(self.check('String id = "TEST-P4-FINISH-1005";',
                                   filename="app/src/test/X.java")[0])

    def test_pins_require_independent_exact_head(self):
        line = 'String id = "d23443e0-2abb-4df4-912f-859b9367aaef";'
        self.assertFalse(self.check(line)[0])
        body = BODY.replace("## Evidence", "- Completion exception: NECESSARY: isolated real failure; Remove when: defect fixed\n\n## Evidence")
        marker = f"APPROVE COMPLETION EXCEPTION #123 {HEAD}"
        self.assertFalse(self.check(line, body)[0])
        self.assertFalse(self.check(line, body, comments=[{"user": {"login": "agent"},
                         "author_association": "OWNER", "body": marker}])[0])
        self.assertFalse(self.check(line, body, comments=[{"user": {"login": "owner"},
                         "author_association": "OWNER", "body": marker.replace(HEAD, BASE)}])[0])
        self.assertTrue(self.check(line, body, comments=[{"user": {"login": "owner"},
                        "author_association": "OWNER", "body": marker}])[0])

    def test_new_or_invalidated_evidence(self):
        for declaration, expected in [
            ("FWH-AC2: repeat old test", False),
            ("FWH-AC2: NEW: first observed deletion", True),
            ("FWH-AC2: INVALIDATED: repeat", False),
            ("FWH-AC2: INVALIDATED: journal; Prior evidence: #104; Changed boundary: observed contradictory journal", True),
        ]:
            with self.subTest(declaration=declaration):
                self.assertEqual(self.check(body=BODY.replace("evidence: NONE", "evidence: " + declaration))[0], expected)

    def test_closeout_and_blocked_transition(self):
        after = roadmap("COMPLETE", "ACTIVE", "5E-T03")
        filename = "docs/ROADMAP.md"
        body = BODY.replace("Change level: Level 2", "Change level: Level 1")
        self.assertFalse(self.check(body=body, filename=filename, after=after)[0])
        cited = body.replace("## Evidence", "- Activation evidence: PASS: 5E-T02 enabled, #129\n- Acceptance evidence: PASS: 5E-T02 observed result, docs/record.md\n\n## Evidence")
        self.assertTrue(self.check(body=cited, filename=filename, after=after)[0])
        self.assertFalse(self.check(body=cited.replace("PASS: 5E-T02 enabled", "PENDING: 5E-T02 disabled"),
                                    filename=filename, after=after)[0])
        blocked = roadmap("BLOCKED", "ACTIVE", "5E-T03")
        self.assertFalse(self.check(body=body, filename=filename, after=blocked)[0])
        stated = body.replace("## Evidence", "- Construction blocker: verified external outage\n- Resume condition: provider recovers\n\n## Evidence")
        self.assertTrue(self.check(body=stated, filename=filename, after=blocked)[0])

if __name__ == "__main__":
    unittest.main()
