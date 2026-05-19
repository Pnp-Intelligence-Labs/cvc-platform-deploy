#!/usr/bin/env python3
"""
news_fetcher.py — Google News RSS aggregator for QQQ / Nasdaq-100 company tracking.

Monitors all QQQ companies for:
  • Venture activity & investments
  • Corporate Venture Capital (CVC) deals
  • Mergers & Acquisitions (M&A)
  • Lawsuits & legal actions
  • Budget expansions & capital allocation

Cron: run every 6 hours — 0 */6 * * *

Usage (on Dell server):
    cd /home/nathan11/repos/cvc-intelligence
    PYTHONPATH=/home/nathan11/repos/cvc-intelligence/core python3 workers/scrapers/news_fetcher.py
"""

import sys
import time
import re
from datetime import datetime
from urllib.parse import quote

import feedparser

from db.connection import get_connection, is_job_enabled
from job_logger import start_job, finish_job

# ── Config ────────────────────────────────────────────────────────────────────

IRRELEVANT_KEYWORDS = ['hiring', 'job', 'employment', 'careers', 'internship']

# Search query that targets CVC / venture / M&A / lawsuit / budget signals
QUERY_TEMPLATE = (
    '"{company}" AND ('
    '"venture capital" OR "corporate venture" OR "CVC" OR '
    '"acquisition" OR "merger" OR "acquires" OR "M&A" OR '
    '"lawsuit" OR "sued" OR "legal action" OR "antitrust" OR '
    '"budget expansion" OR "capital expenditure" OR "R&D spending" OR '
    '"investment" OR "strategic partnership" OR "joint venture" OR '
    '"Series A" OR "Series B" OR "Series C" OR "funding round"'
    ') -hiring -job -careers'
)

GOOGLE_NEWS_RSS = (
    'https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en'
)

MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 5

# Activity type classification keywords
ACTIVITY_PATTERNS = {
    'venture':  re.compile(r'venture capital|corporate venture|cvc|funding round|series [a-d]|seed round|startup|incubat|accelerat', re.I),
    'ma':       re.compile(r'acqui|merger|m&a|buyout|takeover|divest', re.I),
    'lawsuit':  re.compile(r'lawsuit|sued|legal action|antitrust|litigation|settlement|class action|regulatory|fine|penalt', re.I),
    'budget':   re.compile(r'budget|capital expenditure|capex|r&d spend|investment|expand|growth|revenue|earnings|profit', re.I),
    'partnership': re.compile(r'partnership|joint venture|strategic alliance|collaborat|deal|contract', re.I),
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def is_relevant(title):
    """Filter out hiring/job posts."""
    lower = title.lower()
    return not any(kw in lower for kw in IRRELEVANT_KEYWORDS)


def is_within_date_range(dt):
    """Only keep articles from 2024 to present."""
    return 2024 <= dt.year <= datetime.now().year


def classify_activity(title):
    """Classify article into an activity type based on headline keywords."""
    for activity_type, pattern in ACTIVITY_PATTERNS.items():
        if pattern.search(title):
            return activity_type
    return 'general'


def get_watched_companies(cur):
    """Load all active companies from DB."""
    cur.execute("""
        SELECT company_name, category, ticker, partner_id
        FROM cvc.news_watch_companies
        WHERE active = TRUE
        ORDER BY company_name
    """)
    return cur.fetchall()


def get_existing_headlines(cur, company_name):
    """Load existing headlines to deduplicate."""
    cur.execute("""
        SELECT title FROM cvc.category_news
        WHERE company_name = %s
    """, (company_name,))
    return {row['title'] for row in cur.fetchall()}


def insert_article(cur, link, company_name, category,
                   title, published_at, formatted_date, activity_type, partner_id=None):
    """Insert a new article. Returns True if inserted (not a duplicate)."""
    cur.execute("""
        INSERT INTO cvc.category_news
            (link, company_name, category, title, published_at, formatted_date, activity_type, partner_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (title, company_name) DO NOTHING
        RETURNING id
    """, (link, company_name, category, title, published_at, formatted_date, activity_type, partner_id))
    return cur.fetchone() is not None


# ── Core fetch logic ─────────────────────────────────────────────────────────

def fetch_and_append_news(cur, conn, company_name, category='QQQ', partner_id=None):
    """
    Fetch Google News RSS for a company and insert new articles.
    Returns count of new articles inserted.
    """
    query = QUERY_TEMPLATE.format(company=company_name)
    url = GOOGLE_NEWS_RSS.format(query=quote(query))

    new_count = 0
    retries = MAX_RETRIES
    success = False

    while retries > 0 and not success:
        try:
            print(f"    Fetching: {url[:120]}...")
            feed = feedparser.parse(url)

            # feedparser doesn't raise on HTTP errors — check status
            status = feed.get('status', 200)
            if status == 503:
                print("    Error 503: Server unavailable. Retrying...")
                time.sleep(RETRY_DELAY_SECONDS)
                retries -= 1
                continue

            success = True
            headlines = get_existing_headlines(cur, company_name)

            for entry in feed.entries:
                try:
                    link = entry.get('link', '')
                    title = entry.get('title', '').strip()

                    if not link or not title:
                        continue

                    # Parse published date
                    pub_parsed = entry.get('published_parsed')
                    if pub_parsed:
                        dt = datetime(*pub_parsed[:6])
                    else:
                        continue  # skip entries without dates

                    # Apply filters
                    if not is_within_date_range(dt):
                        continue
                    if title in headlines:
                        continue
                    if not is_relevant(title):
                        continue

                    # Classify activity type
                    activity_type = classify_activity(title)
                    formatted = dt.strftime('%Y-%m-%d %H:%M')

                    if insert_article(cur, link, company_name, category,
                                      title, dt, formatted, activity_type, partner_id):
                        new_count += 1
                        headlines.add(title)
                        print(f"      + [{activity_type}] {title[:80]}")

                except Exception as e:
                    print(f"      Error processing entry: {e}")
                    continue

            conn.commit()

        except Exception as e:
            print(f"    Error fetching/parsing: {e}")
            conn.rollback()
            retries -= 1
            if retries > 0:
                print(f"    Retrying in {RETRY_DELAY_SECONDS}s...")
                time.sleep(RETRY_DELAY_SECONDS)

    return new_count


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    if not is_job_enabled("News Fetcher"):
        print("Job disabled in scheduler — exiting")
        sys.exit(0)

    run_id = start_job("News Fetcher", "dell")
    total_new = 0
    companies_processed = 0
    errors = 0

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                companies = get_watched_companies(cur)

                if not companies:
                    print("No active watched companies found.")
                    finish_job(run_id, "ok", {"note": "no companies configured"})
                    return

                print(f"Found {len(companies)} companies to process\n")

                for row in companies:
                    company_name = row['company_name']
                    category = row.get('category', 'QQQ')
                    partner_id = row.get('partner_id')

                    print(f"  [{row.get('ticker', '???')}] {company_name}")
                    companies_processed += 1

                    try:
                        count = fetch_and_append_news(
                            cur, conn, company_name, category, partner_id
                        )
                        total_new += count
                        if count > 0:
                            print(f"    → {count} new articles")
                    except Exception as e:
                        print(f"    FAILED: {e}")
                        errors += 1
                        conn.rollback()

        print(f"\nSummary: {total_new} new articles across "
              f"{companies_processed} companies ({errors} errors)")

        finish_job(run_id, "ok", {
            "new_articles": total_new,
            "companies_processed": companies_processed,
            "errors": errors,
        })

    except Exception as e:
        finish_job(run_id, "error", error_text=str(e))
        raise


if __name__ == "__main__":
    main()
