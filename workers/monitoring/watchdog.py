"""
watchdog.py — CVC nightly job completion check.
Queries cvc.job_runs for today's jobs and sends a Telegram summary.
Zero LLM calls. Zero OpenRouter cost.

Modes:
  --mode daily           Check overnight jobs (default). Run at 7:00 AM UTC.
  --mode weekly-signals  Check weekly signals scraper. Run at 8:00 AM UTC Sunday.
  --mode weekly-briefing Check weekly briefing generation. Run at 10:00 AM UTC Monday.

Cron on Dell (nathan11@100.83.104.117):
  0 7 * * *   /home/nathan11/scripts/run_watchdog.sh --mode daily
  0 8 * * 0   /home/nathan11/scripts/run_watchdog.sh --mode weekly-signals
  0 10 * * 1  /home/nathan11/scripts/run_watchdog.sh --mode weekly-briefing
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras
import requests

DB_CONFIG = dict(
    host=os.environ.get("CVC_DB_HOST", "100.83.104.117"),
    port=int(os.environ.get("CVC_DB_PORT", "5432")),
    dbname="cvc_db",
    user="producer",
    password=os.environ["CVC_DB_PASSWORD"],
)

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "8439605362:AAEs0kErefS7YL9JcAx4H_TpTSOSGiBgLrM")
CHAT_ID   = os.environ.get("TELEGRAM_CHAT_ID", "8310039682")

# Jobs checked per mode. Each entry: (job_name, friendly_label)
DAILY_JOBS = [
    ("RSS / Content Collection",        "RSS Collection"),
    ("Company Enrichment — Phase 1",    "Phase 1 Enrichment"),
    ("Briefing Article Fetch",          "Briefing Articles"),
    ("Briefing Podcast Fetch",          "Briefing Podcasts"),
    ("Briefing Content Enrichment",     "Briefing Enrichment"),
]
WEEKLY_SIGNALS_JOBS = [
    ("Weekly Signals Scraper",          "Weekly Signals"),
]
WEEKLY_BRIEFING_JOBS = [
    ("Weekly Briefing Generation",      "Weekly Briefing"),
]


def _get_today_runs(cur, job_names: list[str]) -> dict:
    """Return dict of job_name → most recent run row from today (UTC)."""
    cur.execute("""
        SELECT DISTINCT ON (job_name)
            job_name, status, finished_at, summary, error_text, started_at
        FROM cvc.job_runs
        WHERE job_name = ANY(%s)
          AND started_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')
        ORDER BY job_name, started_at DESC
    """, (job_names,))
    return {row["job_name"]: row for row in cur.fetchall()}


def _format_summary(row: dict) -> str:
    """One-line summary string from a job_runs row."""
    s = row.get("summary") or {}
    if isinstance(s, str):
        try:
            s = json.loads(s)
        except Exception:
            s = {}
    parts = []
    for k, v in s.items():
        parts.append(f"{v} {k}")
    return ", ".join(parts) if parts else ""


def _send_telegram(text: str) -> None:
    try:
        requests.post(
            f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
            json={"chat_id": CHAT_ID, "text": text},
            timeout=10,
        )
    except Exception as e:
        print(f"[watchdog] Telegram send failed: {e}")


def check(jobs: list[tuple], mode: str) -> None:
    conn = psycopg2.connect(**DB_CONFIG, cursor_factory=psycopg2.extras.RealDictCursor)
    cur = conn.cursor()

    job_names = [j[0] for j in jobs]
    runs = _get_today_runs(cur, job_names)
    conn.close()

    now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [f"🤖 CVC Watchdog — {now_utc}", ""]

    all_ok = True
    for job_name, label in jobs:
        row = runs.get(job_name)
        if not row:
            lines.append(f"❌ {label} — DID NOT RUN")
            all_ok = False
        elif row["status"] == "running":
            lines.append(f"⏳ {label} — still running (started {row['started_at'].strftime('%H:%M UTC')})")
            all_ok = False
        elif row["status"] == "error":
            err = (row.get("error_text") or "unknown error")[:80]
            lines.append(f"❌ {label} — FAILED: {err}")
            all_ok = False
        else:
            summary = _format_summary(row)
            suffix = f" — {summary}" if summary else ""
            lines.append(f"✅ {label}{suffix}")

    lines.append("")
    lines.append("All jobs OK." if all_ok else "⚠️ Action needed.")

    message = "\n".join(lines)
    print(message)
    _send_telegram(message)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["daily", "weekly-signals", "weekly-briefing"],
                        default="daily")
    args = parser.parse_args()

    if args.mode == "daily":
        check(DAILY_JOBS, "daily")
    elif args.mode == "weekly-signals":
        check(WEEKLY_SIGNALS_JOBS, "weekly-signals")
    elif args.mode == "weekly-briefing":
        check(WEEKLY_BRIEFING_JOBS, "weekly-briefing")
