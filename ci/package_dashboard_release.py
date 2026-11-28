"""Package the normal Pages release with versioned local assets and one public revision marker."""
import argparse
import json
from pathlib import Path
import re
import shutil
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

REVISION = re.compile(r"[0-9a-f]{40}")
ASSET = re.compile(r'\b(src|href)="([^"]+)"')
META = '<meta name="fwh-dashboard-build" content="unpackaged">'


def package(source, output, revision):
    source, output = Path(source).resolve(), Path(output).resolve()
    if not REVISION.fullmatch(revision):
        raise ValueError("Expected full Git revision")
    if output.exists() or output == source or source in output.parents:
        raise ValueError("Use a new output directory outside the source")
    if not (source / "index.html").is_file():
        raise ValueError("Missing dashboard entry point")
    shutil.copytree(source, output)
    for page in sorted(output.rglob("*.html")):
        def version(match):
            attribute, raw = match.groups()
            url = urlsplit(raw)
            if url.scheme or url.netloc or not url.path or url.path.startswith("/"):
                return match.group(0)
            if Path(url.path).suffix.lower() not in {".js", ".css", ".png", ".svg", ".ico", ".webp"}:
                return match.group(0)
            target = (page.parent / url.path).resolve()
            if output not in target.parents or not target.is_file():
                raise ValueError(f"Missing or invalid local asset: {page.name}: {url.path}")
            query = [(k, v) for k, v in parse_qsl(url.query, keep_blank_values=True) if k != "v"]
            query.append(("v", revision))
            return f'{attribute}="{urlunsplit(("", "", url.path, urlencode(query), url.fragment))}"'

        html = ASSET.sub(version, page.read_text(encoding="utf-8"))
        if page == output / "index.html":
            if html.count(META) != 1:
                raise ValueError("Missing or duplicate dashboard build marker")
            html = html.replace(META, f'<meta name="fwh-dashboard-build" content="{revision}">')
        page.write_text(html, encoding="utf-8")
    (output / "dashboard-release.json").write_text(
        json.dumps({"revision": revision}) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--revision", required=True)
    args = parser.parse_args()
    package(args.source, args.output, args.revision)
