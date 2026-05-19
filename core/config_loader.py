"""
config_loader.py — Singleton ConfigLoader for platform settings.

Loads from cvc.platform_settings on first access. Falls back to
hardcoded Safe Defaults if the DB is unreachable or the key is missing.
Never raises. Always returns a usable string.

Usage:
    from core.config_loader import config

    thesis = config.get("investment_thesis")
    partners = config.get("corporate_partners_context")

Keys (seeded in migration 077):
    investment_thesis           — Core fund focus statement
    corporate_partners_context  — F500 advisory context
    sector_focus                — Sector bullet list for relevance scoring
    analyst_context             — Firm description for enrichment prompts
"""

import logging
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# ── Safe Defaults ─────────────────────────────────────────────────────────────
# Returned if DB is unreachable OR the key isn't in cvc.platform_settings.
# Keep these in sync with the seed data in migration 077.

SAFE_DEFAULTS: Dict[str, str] = {
    "investment_thesis": (
        "Pre-seed to Series A fund focused on supply chain, industrials, and robotics."
    ),
    "corporate_partners_context": (
        "CVC advises ~25 Fortune 500 corporate partners including Walmart, Amazon, "
        "Honeywell, Caterpillar, John Deere, Siemens, ABB, Rockwell Automation, "
        "Parker Hannifin, Emerson Electric, Zebra Technologies, and Carrier Global."
    ),
    "sector_focus": (
        "- Supply chain, logistics, warehousing, fulfillment\n"
        "- Robotics, automation, industrial technology\n"
        "- Venture capital, startup funding, M&A\n"
        "- Enterprise technology, ERP, digital transformation\n"
        "- Macroeconomics, trade policy, tariffs, markets\n"
        "- Corporate strategy, executive leadership, earnings"
    ),
    "analyst_context": (
        "A firm that advises Fortune 500 companies on startup partnerships "
        "and invests in pre-seed to Series A supply chain/industrial startups."
    ),
}


class _ConfigLoader:
    """
    Singleton. Loads cvc.platform_settings once per process; caches in memory.
    Thread-safe for read-only access after first load.
    """

    _instance: Optional["_ConfigLoader"] = None
    _cache: Dict[str, str]
    _loaded: bool

    def __new__(cls) -> "_ConfigLoader":
        if cls._instance is None:
            inst = super().__new__(cls)
            inst._cache = {}
            inst._loaded = False
            cls._instance = inst
        return cls._instance

    def _load(self) -> None:
        if self._loaded:
            return
        try:
            from db.connection import get_connection
            with get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT key, value FROM cvc.platform_settings")
                    rows = cur.fetchall()
            for row in rows:
                self._cache[row["key"]] = row["value"]
            logger.info(f"ConfigLoader: loaded {len(self._cache)} settings from DB")
        except Exception as e:
            logger.warning(
                f"ConfigLoader: DB load failed ({e}) — Safe Defaults active for all keys"
            )
        finally:
            self._loaded = True

    def get(self, key: str) -> str:
        """
        Return the value for key. Never raises.
        Priority: DB cache → Safe Default → empty string (with warning).
        """
        self._load()
        if key in self._cache:
            return self._cache[key]
        if key in SAFE_DEFAULTS:
            logger.warning(
                f"ConfigLoader: '{key}' not in DB — using Safe Default"
            )
            return SAFE_DEFAULTS[key]
        logger.warning(
            f"ConfigLoader: '{key}' not found anywhere — returning empty string"
        )
        return ""

    def reload(self) -> None:
        """Force a fresh DB load (call after updating cvc.platform_settings)."""
        self._loaded = False
        self._cache.clear()
        self._load()


# Module-level singleton — import this directly
config = _ConfigLoader()
