#!/usr/bin/env python3
# Cron: run weekly Sunday 6AM — 0 6 * * 0

import argparse
import sys
from datetime import datetime, timedelta
from urllib.parse import urlparse
from typing import List, Optional

import feedparser

from db.connection import get_connection, is_job_enabled
from job_logger import start_job, finish_job
from notifications import write_cron_error

# Sector to RSS feeds mapping
SECTOR_FEEDS = {
    "robotics": [
        "https://feeds.feedburner.com/TheRobotReport",
        "https://roboticsbusinessreview.com/feed",
    ],
    "supply_chain": [
        "https://www.supplychainbrain.com/rss",
    ],
    "industrial_auto": [
        "https://www.automationworld.com/rss.xml",
    ],
    "physical_ai": [
        "https://feeds.arstechnica.com/arstechnica/index",
        "https://venturebeat.com/feed",
    ],
    "manufacturing": [
        "https://www.manufacturingdive.com/feeds/news/",
        "https://www.mfgtechupdate.com/feed/",
    ],
}

ALL_SECTORS = list(SECTOR_FEEDS.keys())


def get_domain_from_url(url: str) -> str:
    """Extract domain from URL."""
    try:
        parsed = urlparse(url)
        return parsed.netloc.replace("www.", "")
    except Exception:
        return url


def compute_quarter(date: datetime) -> str:
    """Compute quarter string QN-YYYY from datetime."""
    year = date.year
    quarter = (date.month - 1) // 3 + 1
    return f"Q{quarter}-{year}"


def url_exists_in_raw_signals(cur, url: str) -> bool:
    """Check if URL already exists in trend_report.raw_signals."""
    cur.execute(
        "SELECT 1 FROM trend_report.raw_signals WHERE source_url = %s LIMIT 1",
        (url,)
    )
    return cur.fetchone() is not None


def insert_news_signal(cur, title: str, url: str, source: str, summary: str,
                       sector: str, published_at: datetime) -> bool:
    """Insert a news signal into trend_report.raw_signals."""
    quarter = compute_quarter(published_at)
    content = summary[:500] if summary else ""

    cur.execute(
        """
        INSERT INTO trend_report.raw_signals
        (title, source_url, source_name, content, sector_tags, signal_type, source_type, published_at, quarter, collected_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT DO NOTHING
        RETURNING id
        """,
        (title, url, source, content, [sector], "news", "rss", published_at, quarter)
    )
    return cur.fetchone() is not None


def process_feed(cur, conn, feed_url: str, sector: str) -> int:
    """Process a single RSS feed and return count of new signals inserted."""
    new_count = 0
    try:
        feed = feedparser.parse(feed_url)

        for entry in feed.entries:
            try:
                # Get URL
                url = entry.get("link", "")
                if not url:
                    continue

                # Check for duplicates
                if url_exists_in_raw_signals(cur, url):
                    continue

                # Get title
                title = entry.get("title", "").strip()
                if not title:
                    continue

                # Get source domain
                source = get_domain_from_url(url)

                # Get summary/description
                summary = entry.get("description", "") or entry.get("summary", "") or ""
                # Basic HTML cleanup
                summary = summary.replace("<p>", " ").replace("</p>", " ")
                summary = summary.replace("<br>", " ").replace("<br/>", " ")
                summary = summary.replace("<br />", " ")

                # Get published date
                published_parsed = entry.get("published_parsed") or entry.get("updated_parsed")
                if published_parsed:
                    published_at = datetime(*published_parsed[:6])
                else:
                    # Fallback to current time if no date
                    published_at = datetime.now()

                # Insert signal
                if insert_news_signal(cur, title, url, source, summary, sector, published_at):
                    new_count += 1

            except Exception as e:
                print(f"  Error processing entry from {feed_url}: {e}")
                conn.rollback()  # Reset cursor state so next entry works
                continue

    except Exception as e:
        print(f"Error fetching feed {feed_url}: {e}")

    return new_count


def collect_funding_signals(cur, sectors: List[str]) -> int:
    """Query cvc.funding_rounds for last 30 days and insert funding signals."""
    new_count = 0
    thirty_days_ago = datetime.now() - timedelta(days=30)

    try:
        cur.execute(
            """
            SELECT fr.company_id, fr.amount_usd, fr.announced_date, fr.round_type,
                   c.name as company_name, c.sector
            FROM cvc.funding_rounds fr
            JOIN cvc.companies c ON fr.company_id = c.id
            WHERE fr.announced_date >= %s
            AND c.sector = ANY(%s)
            """,
            (thirty_days_ago, sectors)
        )

        rows = cur.fetchall()

        for row in rows:
            try:
                company_name = row["company_name"]
                amount = row["amount_usd"]
                announced_date = row["announced_date"]
                sector = row["sector"]

                # Format amount
                if amount:
                    if amount >= 1000000000:
                        amount_str = f"${amount/1000000000:.1f}B"
                    elif amount >= 1000000:
                        amount_str = f"${amount/1000000:.1f}M"
                    else:
                        amount_str = f"${amount/1000:.0f}K"
                else:
                    amount_str = "undisclosed amount"

                title = f"{company_name} raised {amount_str}"

                # Check for existing funding signal for this company on this date
                cur.execute(
                    """
                    SELECT 1 FROM trend_report.raw_signals
                    WHERE signal_type = 'funding'
                    AND title = %s
                    AND published_at = %s
                    LIMIT 1
                    """,
                    (title, announced_date)
                )

                if cur.fetchone():
                    continue

                quarter = compute_quarter(announced_date)

                cur.execute(
                    """
                    INSERT INTO trend_report.raw_signals
                    (title, source_url, source_name, content, sector_tags, signal_type, source_type, published_at, quarter, collected_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT DO NOTHING
                    RETURNING id
                    """,
                    (
                        title,
                        "",
                        "cvc_database",
                        f"Funding round: {row['round_type'] or 'Unknown'}",
                        [sector],
                        "funding",
                        "database",
                        announced_date,
                        quarter
                    )
                )

                if cur.fetchone():
                    new_count += 1

            except Exception as e:
                print(f"  Error processing funding round: {e}")
                continue

    except Exception as e:
        print(f"Error querying funding rounds: {e}")

    return new_count


def main():
    if not is_job_enabled("Weekly Signals Scraper"):
        print("Job disabled in scheduler — exiting")
        sys.exit(0)

    parser = argparse.ArgumentParser(description="Weekly signal scraper for CVC Intelligence")
    parser.add_argument(
        "--sector",
        choices=ALL_SECTORS,
        help="Run for specific sector only (default: all sectors)"
    )
    args = parser.parse_args()

    sectors_to_process = [args.sector] if args.sector else ALL_SECTORS

    total_new_signals = 0
    total_feeds_processed = 0
    feeds_successful = 0

    run_id = start_job("Weekly Signals Scraper", "dell")
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                # Process RSS feeds for each sector
                for sector in sectors_to_process:
                    print(f"\nProcessing sector: {sector}")
                    feeds = SECTOR_FEEDS.get(sector, [])

                    for feed_url in feeds:
                        total_feeds_processed += 1
                        print(f"  Fetching: {feed_url}")

                        try:
                            count = process_feed(cur, conn, feed_url, sector)
                            feeds_successful += 1
                            total_new_signals += count
                            if count > 0:
                                print(f"    Inserted {count} new signals")
                            conn.commit()
                        except Exception as e:
                            print(f"    FAILED: {e}")
                            conn.rollback()

                # Process funding signals
                print(f"\nProcessing funding signals...")
                funding_count = collect_funding_signals(cur, sectors_to_process)
                total_new_signals += funding_count
                if funding_count > 0:
                    print(f"  Inserted {funding_count} funding signals")

                conn.commit()

        print(f"\nSummary: {total_new_signals} new signals inserted across {feeds_successful}/{total_feeds_processed} feeds")
        finish_job(run_id, "ok", {"total_new_signals": total_new_signals, "feeds_successful": feeds_successful, "feeds_total": total_feeds_processed})

    except Exception as e:
        finish_job(run_id, "error", error_text=str(e))
        write_cron_error("Weekly Signals Scraper", str(e), source="weekly_signals")
        raise


if __name__ == "__main__":
    main()
