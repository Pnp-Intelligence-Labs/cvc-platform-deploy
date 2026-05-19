"""
fetch_articles.py — RSS Article Collector for Weekly Briefing

Reads active RSS sources from cvc.briefing_sources and inserts new articles
into cvc.content_items (status='raw') for the enrichment worker to pick up.

Deduplicates by URL (content_hash). Only pulls articles from the past 14 days.

Usage:
  python3 fetch_articles.py           # collect from all active RSS sources
  python3 fetch_articles.py --dry-run # print what would be inserted, no DB writes
  python3 fetch_articles.py --days 7  # look back N days (default 14)
"""

import argparse
import hashlib
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import feedparser
import psycopg2
import psycopg2.extras

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "core"))
from job_logger import start_job, finish_job

DB_CONFIG = dict(
    dbname="cvc_db",
    user="producer",
    password=os.environ["CVC_DB_PASSWORD"],
    host=os.environ.get("CVC_DB_HOST", "100.83.104.117"),
    port=5432,
)

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CVCBot/1.0; research)"}

# Keywords that make an article relevant to CVC thesis
RELEVANCE_KEYWORDS = [
    "robot", "robotics", "automation", "supply chain", "logistics", "warehouse",
    "manufacturing", "industrial", "ai", "startup", "funding", "raises", "series",
    "venture", "acquisition", "autonomous", "freight", "factory", "sensor",
    "machine learning", "deep learning", "computer vision", "physical ai",
    "humanoid", "cobot", "agv", "amr", "scada", "plc", "digital twin",
    "predictive", "simulation", "software", "saas", "b2b",
]


def url_hash(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()[:64]


def is_relevant(title: str, summary: str) -> bool:
    text = f"{title} {summary}".lower()
    return any(kw in text for kw in RELEVANCE_KEYWORDS)


def get_rss_sources(conn) -> list:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT id, name, url FROM cvc.briefing_sources
            WHERE active = TRUE AND source_type = 'rss' AND url IS NOT NULL
            ORDER BY name
        """)
        return cur.fetchall()


def already_exists(conn, content_hash: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM cvc.content_items WHERE content_hash = %s LIMIT 1", (content_hash,))
        return cur.fetchone() is not None


def insert_article(conn, title, url, summary, published_at, source_name, content_hash, dry_run):
    if dry_run:
        print(f"    [dry-run] Would insert: {title[:80]}")
        return True
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO cvc.content_items
                (content_type, title, url, raw_text, summary, tags, enrichment_status,
                 content_hash, published_at)
            VALUES ('article', %s, %s, %s, %s, %s, 'raw', %s, %s)
            ON CONFLICT (content_hash) DO NOTHING
        """, (
            title[:500],
            url[:1000],
            summary[:10000],
            summary[:1000],
            f'["{source_name}"]',
            content_hash,
            published_at,
        ))
    conn.commit()
    return True


def process_feed(conn, source, cutoff: datetime, dry_run: bool) -> dict:
    name = source["name"]
    url  = source["url"]

    try:
        parsed = feedparser.parse(url)
    except Exception as e:
        return {"source": name, "new": 0, "skipped": 0, "error": str(e)}

    if parsed.bozo and not parsed.entries:
        return {"source": name, "new": 0, "skipped": 0,
                "error": f"Feed parse error: {getattr(parsed, 'bozo_exception', 'unknown')}"}

    new = skipped = irrelevant = 0

    for entry in parsed.entries:
        title   = (entry.get("title") or "").strip()
        link    = (entry.get("link") or "").strip()
        summary = (entry.get("summary") or entry.get("description") or "").strip()

        if not title or not link:
            continue

        # Date filter
        published = entry.get("published_parsed") or entry.get("updated_parsed")
        pub_dt = None
        if published:
            pub_dt = datetime(*published[:6], tzinfo=timezone.utc)
            if pub_dt < cutoff:
                continue  # too old

        # Relevance filter — skip if the source is a general news site
        # (pure-vertical sources like TheRobotReport are always relevant)
        general_sources = {"VentureBeat", "VentureBeat AI", "Ars Technica", "Crunchbase News", "Betakit"}
        if name in general_sources and not is_relevant(title, summary):
            irrelevant += 1
            continue

        chash = url_hash(link)
        if already_exists(conn, chash):
            skipped += 1
            continue

        insert_article(conn, title, link, summary, pub_dt, name, chash, dry_run)
        new += 1
        print(f"    + {title[:80]}")

    print(f"  {name}: {new} new, {skipped} existing, {irrelevant} irrelevant")
    return {"source": name, "new": new, "skipped": skipped, "irrelevant": irrelevant}


def run(days: int = 14, dry_run: bool = False):
    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=days)
    print(f"RSS Article Collector — lookback {days} days (since {cutoff.date()})")
    if dry_run:
        print("[dry-run mode — no writes]")

    conn = psycopg2.connect(**DB_CONFIG)
    sources = get_rss_sources(conn)
    print(f"Found {len(sources)} active RSS sources\n")

    total_new = total_skipped = 0
    for source in sources:
        print(f"Fetching: {source['name']}")
        result = process_feed(conn, source, cutoff, dry_run)
        total_new     += result.get("new", 0)
        total_skipped += result.get("skipped", 0)
        if result.get("error"):
            print(f"  ERROR: {result['error']}")
        time.sleep(0.5)  # polite pause between feeds

    conn.close()
    print(f"\n{'='*50}")
    print(f"DONE: {total_new} new articles | {total_skipped} already existed")
    print(f"{'='*50}")
    return total_new


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RSS article collector for weekly briefing")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be inserted, no DB writes")
    parser.add_argument("--days",    type=int, default=14,  help="Look back N days (default 14)")
    args = parser.parse_args()

    run_id = start_job("Briefing Article Fetch", "refinery")
    try:
        result = run(days=args.days, dry_run=args.dry_run)
        finish_job(run_id, "ok", {"new_articles": result})
    except Exception as e:
        finish_job(run_id, "error", error_text=str(e))
        raise
