"""
scrapling.py — Scrapling web scraper skill.
Handles JS-heavy sites, anti-bot protection, Cloudflare.
Best for: LinkedIn, Crunchbase, news articles, paywalled previews.
Falls short on: speed (slower than Brave), sites requiring login.

Scrapling strategies (tried in order):
1. Fetcher       — fast HTTP fetch with stealth headers
2. PlaywrightFetcher — full browser render for JS-heavy pages
"""

import requests
from monitor.tracker import track


@track("scrapling")
def fetch(url: str, pipeline: str = None, agent: str = None) -> dict:
    """
    Fetch full text content from a URL.
    Returns {url, text, title, status}.
    """
    try:
        from scrapling.fetchers import Fetcher, PlaywrightFetcher
    except ImportError:
        # Fallback to requests if scrapling not installed
        return _requests_fallback(url)

    # Strategy 1: Fast stealth fetch
    try:
        fetcher = Fetcher(auto_match=False)
        page = fetcher.get(url, stealthy_headers=True, timeout=15)
        if page and page.status == 200:
            text = page.get_all_text(ignore_tags=("script", "style", "nav", "footer"))
            return {
                "url":    url,
                "title":  page.find("title").text if page.find("title") else "",
                "text":   text[:10000],
                "status": "ok",
                "method": "scrapling-fetch",
            }
    except Exception:
        pass

    # Strategy 2: Full browser render
    try:
        fetcher = PlaywrightFetcher(auto_match=False)
        page = fetcher.get(url, timeout=20)
        if page and page.status == 200:
            text = page.get_all_text(ignore_tags=("script", "style", "nav", "footer"))
            return {
                "url":    url,
                "title":  page.find("title").text if page.find("title") else "",
                "text":   text[:10000],
                "status": "ok",
                "method": "scrapling-playwright",
            }
    except Exception:
        pass

    # Strategy 3: Plain requests fallback
    return _requests_fallback(url)


def _requests_fallback(url: str) -> dict:
    """Simple requests fetch — no anti-bot, no JS. Last resort."""
    import re
    try:
        resp = requests.get(
            url,
            headers={"User-Agent": "Mozilla/5.0 (compatible; CVCResearch/1.0)"},
            timeout=10
        )
        resp.raise_for_status()
        text = re.sub(r"<[^>]+>", " ", resp.text)
        text = re.sub(r"\s+", " ", text).strip()
        return {
            "url":    url,
            "title":  "",
            "text":   text[:10000],
            "status": "ok",
            "method": "requests-fallback",
        }
    except Exception as e:
        return {"url": url, "title": "", "text": "", "status": "error", "method": "failed", "error": str(e)}
