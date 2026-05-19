"""
portco_news_worker.py — Weekly news scrape for portfolio companies.

Scrapes each company's OWN website for news/blog/press content.
No Brave search — no third-party noise, no Eurovision articles.

Strategy per company:
1. Try common news paths: /news, /blog, /press, /updates, /newsroom, /changelog, /media
2. Also scan the homepage for article links (many companies put recent posts there)
3. Extract article titles, links, and dates
4. Filter to only links that look like articles (not nav/social/product pages)

Run:
    PYTHONPATH=/home/nathan11/repos/cvc-intelligence/core \
    python3 workers/enrichment/portco_news_worker.py

Cron: Sundays 3:30 AM UTC on Dell
"""

import os, json, time, logging, re
from datetime import datetime, timezone
from urllib.parse import urlparse, urljoin

import psycopg2
from psycopg2.extras import RealDictCursor
import requests
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

DB_DSN = (
    f"host={os.environ.get('CVC_DB_HOST', 'localhost')} "
    f"dbname={os.environ.get('CVC_DB_NAME', 'cvc_db')} "
    f"user={os.environ.get('CVC_DB_USER', 'producer')} "
    f"password={os.environ['CVC_DB_PASSWORD']} "
    "options=-csearch_path=cvc"
)

NEWS_PATHS = [
    "/news", "/blog", "/press", "/newsroom", "/updates",
    "/media", "/changelog", "/announcements", "/insights",
    "/resources/news", "/resources/blog", "/company/news",
    "/about/news", "/about/press",
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; CVCBot/1.0; +https://clawvc.com)",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}

# Patterns that indicate a URL is an article, not a nav/product/social link
ARTICLE_PATH_RE = re.compile(
    r'/(20\d\d|news|blog|press|post|article|update|release|announcement|insight|story)/',
    re.IGNORECASE,
)

# Skip these domains in extracted links — social, docs, legal, etc.
SKIP_DOMAINS = {
    "twitter.com", "x.com", "linkedin.com", "facebook.com", "instagram.com",
    "youtube.com", "github.com", "docs.", "support.", "help.", "careers.",
    "jobs.", "app.", "dashboard.", "portal.", "login.", "signup.",
}


def _get_html(url: str, timeout: int = 10) -> str | None:
    try:
        r = requests.get(url, headers=HEADERS, timeout=timeout, allow_redirects=True)
        if r.status_code == 200 and "text/html" in r.headers.get("content-type", ""):
            return r.text
    except Exception as e:
        log.debug("Fetch %s: %s", url, e)
    return None


def _extract_date(el) -> str:
    """Try to find a date near an article link element."""
    for attr in ("datetime", "content"):
        val = el.get(attr, "")
        if val and re.search(r'20\d\d', val):
            return val[:10]
    # Look for time/date tags nearby
    for tag in el.find_all(["time", "span", "p"], limit=5):
        text = tag.get_text(strip=True)
        m = re.search(r'(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s+20\d\d', text)
        if m:
            return m.group(0)
        m2 = re.search(r'20\d\d[-/]\d{2}[-/]\d{2}', text)
        if m2:
            return m2.group(0)
    return ""


def _parse_articles(html: str, base_url: str, domain: str) -> list[dict]:
    """Extract article links from an HTML page."""
    soup = BeautifulSoup(html, "lxml")

    # Remove nav, footer, header, sidebar noise
    for tag in soup.find_all(["nav", "footer", "header", "aside", "script", "style"]):
        tag.decompose()

    articles = []
    seen = set()

    # Find all <a> tags with meaningful href
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue

        full_url = urljoin(base_url, href)
        parsed = urlparse(full_url)

        # Must stay on the same domain or a subdomain
        link_domain = parsed.netloc.replace("www.", "")
        if not (link_domain == domain or link_domain.endswith("." + domain)):
            continue

        # Skip clearly non-article paths
        if any(s in link_domain for s in SKIP_DOMAINS):
            continue
        path = parsed.path.lower()
        if any(p in path for p in ["/cdn-", "/static/", "/assets/", "/images/", ".pdf", ".jpg", ".png", ".svg"]):
            continue
        # Must look like an article URL OR be under a news/blog path
        if not ARTICLE_PATH_RE.search(full_url) and not any(p.rstrip("/") in path for p in NEWS_PATHS):
            continue

        if full_url in seen:
            continue
        seen.add(full_url)

        title = a.get_text(separator=" ", strip=True)
        # Filter out very short or navigation-like titles
        if len(title) < 15 or title.lower() in ("read more", "learn more", "view all", "see all", "click here"):
            # Try parent element for richer text
            parent = a.parent
            if parent:
                title = parent.get_text(separator=" ", strip=True)[:200]
        if len(title) < 15:
            continue

        date = _extract_date(a.parent or a)
        articles.append({
            "title":   title[:200],
            "url":     full_url,
            "snippet": "",
            "age":     date,
        })

    return articles[:20]


def _scrape_company(website: str) -> list[dict]:
    """
    Scrape a company's website for news/blog/press content.
    Tries dedicated news paths first, falls back to homepage scan.
    """
    if not website:
        return []

    base = website if website.startswith("http") else f"https://{website}"
    base = base.rstrip("/")
    parsed = urlparse(base)
    domain = parsed.netloc.replace("www.", "")

    articles = []
    found_path = None

    # Try dedicated news/blog paths first
    for path in NEWS_PATHS:
        url = base + path
        html = _get_html(url)
        if html:
            results = _parse_articles(html, url, domain)
            if results:
                log.debug("  Found %d articles at %s", len(results), path)
                articles.extend(results)
                found_path = path
                break  # first successful news path wins
        time.sleep(0.3)

    # Also scan homepage if no dedicated news path found
    if not found_path:
        html = _get_html(base)
        if html:
            results = _parse_articles(html, base, domain)
            if results:
                log.debug("  Found %d article links on homepage", len(results))
                articles.extend(results)

    # Deduplicate
    seen = set()
    deduped = []
    for a in articles:
        if a["url"] not in seen:
            seen.add(a["url"])
            deduped.append(a)

    return deduped[:10]


def run():
    conn = psycopg2.connect(DB_DSN, cursor_factory=RealDictCursor)
    cur  = conn.cursor()

    cur.execute("""
        SELECT id, name, website
        FROM cvc.companies
        WHERE is_portfolio = TRUE
          AND website IS NOT NULL
          AND (stage IS NULL OR stage != 'Out of Business')
        ORDER BY name
    """)
    companies = cur.fetchall()
    log.info("Portco website scrape — %d companies with websites", len(companies))

    updated  = 0
    no_news  = 0

    for company in companies:
        cid     = company["id"]
        name    = company["name"]
        website = company["website"]

        articles = _scrape_company(website)

        if not articles:
            log.info("  %s — no articles found on website", name)
            # Clear stale Brave-scraped garbage so empty is better than wrong
            cur.execute("UPDATE cvc.companies SET news_articles = '[]'::jsonb WHERE id = %s", (cid,))
            conn.commit()
            no_news += 1
            continue

        cur.execute(
            "UPDATE cvc.companies SET news_articles = %s WHERE id = %s",
            (json.dumps(articles), cid),
        )
        conn.commit()
        log.info("  %s — %d articles", name, len(articles))
        updated += 1
        time.sleep(0.5)

    cur.close()
    conn.close()
    log.info("Done — %d updated, %d no articles found", updated, no_news)


if __name__ == "__main__":
    run()
