"""
ingest_local.py — Local ingestion for ZIP-extracted datarooms.

Use this when files are already in workdir/[company]/ (from extract_dataroom.py).
Runs convert → tag → route → writes manifest.json, same as ingest.py but without Drive.

Usage:
    python3 -m ingestion.ingest_local "10Four"
"""

import json
import argparse
from datetime import datetime
from pathlib import Path

from config.settings import WORKDIR, SUPPORTED_EXTENSIONS
from ingestion.converter import convert_all
from ingestion.tagger import tag_all
from ingestion.router import route, routing_summary


def discover_files(company_dir: Path) -> list[dict]:
    """Walk company_dir recursively and return file dicts for convert_all."""
    files = []
    for path in sorted(company_dir.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue
        # Skip hidden files and already-converted text files
        if path.name.startswith("."):
            continue
        if path.parent.name == "converted":
            continue

        rel = path.relative_to(company_dir)
        files.append({
            "success":    True,
            "local_path": str(path),
            "rel_path":   str(rel),
            "filename":   path.name,
        })
    return files


def run(company: str) -> dict:
    safe        = company.replace(" ", "_").replace("/", "-")
    company_dir = WORKDIR / safe
    converted_dir = company_dir / "converted"

    if not company_dir.exists():
        raise FileNotFoundError(f"workdir not found: {company_dir}\nRun extract_dataroom.py first.")

    print(f"\nLocal ingestion: {company}")
    print(f"Source: {company_dir}/\n")

    # Step 1: Discover
    discovered = discover_files(company_dir)
    print(f"Step 1/4: Found {len(discovered)} supported files")

    # Step 2: Convert
    print("Step 2/4: Converting to text...")
    documents = convert_all(discovered, converted_dir)
    converted = sum(1 for d in documents if d["conversion"] in ("ok", "truncated"))
    failed    = sum(1 for d in documents if d["conversion"] == "failed")
    skipped   = sum(1 for d in documents if d["conversion"] == "skipped")
    print(f"  {converted} converted, {skipped} skipped, {failed} failed")

    # Step 3: Tag
    print("Step 3/4: Tagging documents...")
    documents = tag_all(documents)
    by_type: dict[str, int] = {}
    for d in documents:
        t = d.get("doc_type", "unknown")
        by_type[t] = by_type.get(t, 0) + 1
    for t, n in sorted(by_type.items(), key=lambda x: -x[1]):
        print(f"  {t}: {n}")

    # Step 4: Route
    print("Step 4/4: Routing to agents...")
    routing = route(documents)
    print(routing_summary(routing))

    # Write manifest
    manifest = {
        "company":   company,
        "date":      datetime.now().strftime("%Y-%m-%d"),
        "source":    "local",
        "documents": [
            {k: v for k, v in d.items() if k != "text"}
            for d in documents
        ],
        "routing": routing,
        "summary": {
            "total":     len(documents),
            "converted": converted,
            "skipped":   skipped,
            "failed":    failed,
            "by_type":   by_type,
        },
    }

    manifest_path = company_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"\nManifest saved: {manifest_path}")
    print(f"Local ingestion complete: {company}")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("company", help="Company name (must match extract_dataroom.py --company)")
    args = parser.parse_args()
    run(args.company)
