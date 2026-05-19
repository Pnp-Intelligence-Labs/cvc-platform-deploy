"""
ingest.py — DD Ingestion Bot entry point.

Usage:
    python3 -m ingestion.ingest "Acme Robotics" "https://drive.google.com/drive/folders/..."
    python3 -m ingestion.ingest "Acme Robotics" "https://..." --dry-run

What it does:
    1. Downloads all files from the Google Drive dataroom (recursively)
    2. Converts each file to text
    3. Tags each document by type (pitch_deck, financials, etc.)
    4. Routes documents to the appropriate specialist agents via checklists
    5. Writes manifest.json to workdir/[company]/manifest.json
    6. Sends a summary to Telegram
"""

import json
import argparse
import requests
from datetime import datetime

# Allow running from repo root

from config.settings import WORKDIR, TELEGRAM_TOKEN, TELEGRAM_CHAT
from ingestion.drive import get_service, download_dataroom, upload_report
from ingestion.converter import convert_all
from ingestion.tagger import tag_all
from ingestion.router import route, routing_summary


# ── Telegram ──────────────────────────────────────────────────────────────────

def send_telegram(msg: str, chat_id: str = None):
    if not TELEGRAM_TOKEN:
        return
    cid = chat_id or TELEGRAM_CHAT
    if not cid:
        return
    try:
        requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
            json={"chat_id": cid, "text": msg, "parse_mode": "Markdown"},
            timeout=10
        )
    except Exception:
        pass


# ── Ingestion summary ─────────────────────────────────────────────────────────

def build_summary(company: str, documents: list[dict]) -> str:
    total     = len(documents)
    converted = sum(1 for d in documents if d["conversion"] in ("ok", "truncated"))
    skipped   = sum(1 for d in documents if d["conversion"] == "skipped")
    failed    = sum(1 for d in documents if d["conversion"] in ("failed", "download_failed"))

    by_type: dict[str, int] = {}
    for d in documents:
        t = d.get("doc_type", "unknown")
        by_type[t] = by_type.get(t, 0) + 1

    type_lines = "\n".join(
        f"  • {t}: {n}" for t, n in sorted(by_type.items(), key=lambda x: -x[1])
    )

    return (
        f"*DD Ingestion — {company}*\n\n"
        f"*Files:* {total} total · {converted} converted · {skipped} skipped · {failed} failed\n\n"
        f"*Document types found:*\n{type_lines}"
    )


# ── Main ──────────────────────────────────────────────────────────────────────

def run(company: str, drive_url: str, dry_run: bool = False):
    safe_name   = company.replace(" ", "_").replace("/", "-")
    date_str    = datetime.now().strftime("%Y-%m-%d")
    company_dir = WORKDIR / safe_name
    raw_dir     = company_dir / "raw"
    converted_dir = company_dir / "converted"

    print(f"\n{'[DRY RUN] ' if dry_run else ''}DD Ingestion: {company}")
    print(f"Drive URL: {drive_url}\n")

    # ── Step 1: Download ──────────────────────────────────────────────────────
    print("Step 1/4: Downloading dataroom from Google Drive...")
    if not dry_run:
        service    = get_service()
        downloaded = download_dataroom(service, drive_url, raw_dir)
    else:
        downloaded = []
        print("  [dry-run] skipping download")

    print(f"  {len(downloaded)} files downloaded")

    # ── Step 2: Convert ───────────────────────────────────────────────────────
    print("Step 2/4: Converting documents to text...")
    documents = convert_all(downloaded, converted_dir)

    converted_count = sum(1 for d in documents if d["conversion"] in ("ok", "truncated"))
    print(f"  {converted_count}/{len(documents)} documents converted")

    # ── Step 3: Tag ───────────────────────────────────────────────────────────
    print("Step 3/4: Tagging documents by type...")
    documents = tag_all(documents)

    by_type: dict[str, int] = {}
    for d in documents:
        t = d.get("doc_type", "unknown")
        by_type[t] = by_type.get(t, 0) + 1
    for t, n in sorted(by_type.items(), key=lambda x: -x[1]):
        print(f"  {t}: {n}")

    # ── Step 4: Route ─────────────────────────────────────────────────────────
    print("Step 4/4: Routing documents to specialist agents...")
    routing = route(documents)
    print(routing_summary(routing))

    # ── Write manifest ────────────────────────────────────────────────────────
    manifest = {
        "company":    company,
        "date":       date_str,
        "drive_url":  drive_url,
        "documents":  [
            {k: v for k, v in d.items() if k != "text"}  # exclude text blob
            for d in documents
        ],
        "routing":    routing,
        "summary": {
            "total":     len(documents),
            "converted": sum(1 for d in documents if d["conversion"] in ("ok", "truncated")),
            "skipped":   sum(1 for d in documents if d["conversion"] == "skipped"),
            "failed":    sum(1 for d in documents if d["conversion"] in ("failed", "download_failed")),
            "by_type":   by_type,
        }
    }

    if not dry_run:
        manifest_path = company_dir / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2))
        print(f"\nManifest saved: {manifest_path}")
    else:
        print("\n[dry-run] manifest not saved")

    # ── Telegram summary ──────────────────────────────────────────────────────
    summary_msg = build_summary(company, documents) + "\n\n" + routing_summary(routing)
    summary_msg += f"\n\n_Manifest: workdir/{safe_name}/manifest.json_"

    if not dry_run:
        send_telegram(summary_msg)
        print("Telegram summary sent.")
    else:
        print("\n[dry-run] Telegram message:")
        print(summary_msg)

    print(f"\nIngestion complete: {company}")
    return manifest


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DD Ingestion Bot")
    parser.add_argument("company",   help="Company name (e.g. 'Acme Robotics')")
    parser.add_argument("drive_url", help="Google Drive folder URL")
    parser.add_argument("--dry-run", action="store_true", help="Skip download and Telegram")
    args = parser.parse_args()

    run(args.company, args.drive_url, dry_run=args.dry_run)
