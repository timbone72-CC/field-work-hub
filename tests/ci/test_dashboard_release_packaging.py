import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("packaging", ROOT / "ci/package_dashboard_release.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ReleasePackagingTest(unittest.TestCase):
    def test_versions_all_pages_without_changing_source(self):
        source = ROOT / "dashboard"
        original = {p.name: p.read_bytes() for p in source.glob("*.html")}
        with tempfile.TemporaryDirectory() as tmp:
            first, second = Path(tmp) / "first", Path(tmp) / "second"
            one, two = "a" * 40, "b" * 40
            MODULE.package(source, first, one)
            MODULE.package(source, second, two)
            for name in original:
                html = (first / name).read_text()
                for attr, raw in MODULE.ASSET.findall(html):
                    url = MODULE.urlsplit(raw)
                    if not url.scheme and not url.netloc and Path(url.path).suffix in {".js", ".css", ".png", ".svg", ".ico", ".webp"}:
                        self.assertEqual(dict(MODULE.parse_qsl(url.query))["v"], one, raw)
                        self.assertTrue((first / url.path).is_file(), raw)
                self.assertNotEqual((first / name).read_bytes(), (second / name).read_bytes())
            self.assertIn(f'content="{one}"', (first / "index.html").read_text())
            self.assertEqual(json.loads((first / "dashboard-release.json").read_text()), {"revision": one})
            self.assertEqual((first / "owner-management.js").read_bytes(), (source / "owner-management.js").read_bytes())
        self.assertEqual(original, {p.name: p.read_bytes() for p in source.glob("*.html")})

    def test_rejects_invalid_revision_and_missing_asset(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            source.mkdir()
            (source / "index.html").write_text(MODULE.META + '<script src="missing.js?v=old"></script>')
            with self.assertRaises(ValueError):
                MODULE.package(source, root / "invalid", "not-a-revision")
            with self.assertRaises(ValueError):
                MODULE.package(source, root / "missing", "c" * 40)


if __name__ == "__main__":
    unittest.main()
