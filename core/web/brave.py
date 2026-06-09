"""
web/brave.py — Brave Search API wrapper.

Exposes search() for use across agents and workers.
Primary + backup key fallback via env vars BRAVE_SEARCH_KEY / BRAVE_SEARCH_KEY_BACKUP.
"""

import os

import requests


def _raw(query: str, count: int, key: str) -> list:
    r = requests.get(
        "https://api.search.brave.com/res/v1/web/search",
        headers={"Accept": "application/json", "X-Subscription-Token": key},
        params={"q": query, "count": count},
        timeout=10,
    )
    r.raise_for_status()
    return r.json().get("web", {}).get("results", [])


def search(query: str, count: int = 10) -> list:
    """Search Brave. Returns list of result dicts with keys: title, url, description."""
    primary = os.environ.get("BRAVE_SEARCH_KEY", "") or os.environ.get("BRAVE_API_KEY", "")
    backup  = os.environ.get("BRAVE_SEARCH_KEY_BACKUP", "")
    for key in [primary, backup]:
        if not key:
            continue
        try:
            return _raw(query, count, key)
        except Exception:
            continue
    return []
