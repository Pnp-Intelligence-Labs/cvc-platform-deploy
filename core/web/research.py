"""
web/research.py — Web research utilities for DD agents.

Provides deep_search(): Brave search + lightweight page fetch.
Used by DD specialist agents to find public context on a company.
"""

import os
import requests


def _brave_raw(query: str, count: int, key: str) -> list:
    r = requests.get(
        "https://api.search.brave.com/res/v1/web/search",
        headers={"Accept": "application/json", "X-Subscription-Token": key},
        params={"q": query, "count": count},
        timeout=10,
    )
    r.raise_for_status()
    return r.json().get("web", {}).get("results", [])


def _brave_search(query: str, count: int = 5) -> list:
    primary = os.environ.get("BRAVE_SEARCH_KEY", "")
    backup  = os.environ.get("BRAVE_SEARCH_KEY_BACKUP", "")
    for key in [primary, backup]:
        if not key:
            continue
        try:
            return _brave_raw(query, count, key)
        except Exception:
            continue
    return []


def _fetch_page(url: str, max_chars: int = 3000) -> str:
    """Fetch a URL and strip HTML, return plain text up to max_chars."""
    try:
        import re
        r = requests.get(url, timeout=8, headers={"User-Agent": "Mozilla/5.0"})
        text = re.sub(r"<[^>]+>", " ", r.text)
        text = re.sub(r"\s+", " ", text).strip()
        return text[:max_chars]
    except Exception:
        return ""


def deep_search(query: str, n_fetch: int = 2, pipeline: str = "dd", agent: str = "") -> str:
    """
    Run a Brave search and optionally fetch top n_fetch pages.
    Returns a plain-text block suitable for LLM context.

    Args:
        query:    Search query string
        n_fetch:  Number of result pages to fetch full content from (0 = titles/snippets only)
        pipeline: Tag for logging (unused, kept for API compatibility)
        agent:    Tag for logging (unused, kept for API compatibility)

    Returns:
        Formatted string of search results and page content.
    """
    results = _brave_search(query, count=max(5, n_fetch + 3))
    if not results:
        return f"[No search results for: {query}]"

    lines = [f"Search: {query}\n"]
    for i, r in enumerate(results):
        title   = r.get("title", "")
        url     = r.get("url", "")
        snippet = r.get("description", "")
        lines.append(f"{i+1}. {title}\n   {url}\n   {snippet}")

        if i < n_fetch and url:
            content = _fetch_page(url)
            if content:
                lines.append(f"   [Page content]: {content[:1500]}")

    return "\n\n".join(lines)
