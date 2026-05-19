#!/usr/bin/env python3
"""
entity_resolver.py — Named entity ingestion and company resolution.

Two-phase pipeline:
  Phase 1 — Ingest: scan content_items.key_entities, upsert entity names
            with mention counts and date range into cvc.entities.
  Phase 2 — Resolve: fuzzy-match unresolved entities against cvc.companies,
            set company_id + match_confidence.

This is additive — it never modifies content_items or companies.

Standalone usage:
  PYTHONPATH=/home/nathan11/repos/cvc-intelligence/core python3 entity_resolver.py
  python3 entity_resolver.py --ingest-only
  python3 entity_resolver.py --resolve-only
  python3 entity_resolver.py --stats

Import usage:
  from entity_resolver import run_ingest, run_resolve
"""

import os
import sys
import re
import json
import logging
import argparse
import psycopg2
import psycopg2.extras
from datetime import date
from difflib import SequenceMatcher
from typing import Optional

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "core"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

DB_CONFIG = {
    "dbname":   "cvc_db",
    "user":     "producer",
    "password": os.environ["CVC_DB_PASSWORD"],
    "host":     os.environ.get("CVC_DB_HOST", "localhost"),
    "port":     5432,
}

# Fuzzy match threshold: 0.85 catches "Boston Dynamics" == "Boston Dynamics Inc."
# Lower = more false positives; higher = more misses. 0.85 is the safe floor.
MATCH_THRESHOLD = 0.85

# Generic/noise names to skip — these appear in content but are not companies
_SKIP_NAMES = {
    "inc", "llc", "ltd", "corp", "company", "co", "the", "a", "an",
    "us", "usa", "u.s.", "u.s.a.", "north america", "europe", "asia",
    "amazon", "google", "apple", "microsoft", "tesla",  # too broad for VC signal
    "federal reserve", "congress", "white house", "pentagon",
}


# ── Normalization ─────────────────────────────────────────────────────────────

def _normalize(name: str) -> str:
    """
    Canonical form for dedup and matching.
    Lower-case, strip leading/trailing whitespace, collapse internal whitespace,
    remove punctuation except hyphens (Boston-based → ok), strip common suffixes.
    """
    name = name.lower().strip()
    # Strip common corporate suffixes for matching purposes
    name = re.sub(
        r'\b(inc\.?|llc\.?|ltd\.?|corp\.?|co\.?|plc\.?|gmbh|s\.a\.?|a\.s\.?)\s*$',
        '', name, flags=re.IGNORECASE
    ).strip()
    name = re.sub(r'[^\w\s\-]', '', name)
    name = re.sub(r'\s+', ' ', name)
    return name


def _is_noise(name: str) -> bool:
    """True if this entity string is too generic to be useful."""
    if len(name) < 3:
        return True
    if _normalize(name) in _SKIP_NAMES:
        return True
    # Skip purely numeric strings
    if re.match(r'^\d+$', name.strip()):
        return True
    return False


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


# ── Phase 1: Ingest ───────────────────────────────────────────────────────────

def run_ingest(conn) -> int:
    """
    Scan content_items.key_entities for company names.
    Upsert into cvc.entities: increment mention_count, expand date range.
    Returns count of entities upserted.
    """
    logger.info("entity_resolver: Phase 1 — ingesting from content_items...")

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT
                id,
                key_entities,
                COALESCE(published_at, created_at)::date AS item_date
            FROM cvc.content_items
            WHERE key_entities IS NOT NULL
              AND key_entities != '{}'
              AND key_entities ? 'companies'
        """)
        rows = cur.fetchall()

    logger.info(f"entity_resolver: {len(rows)} content items with entity data")

    # Aggregate: name_normalized → {name, count, first_seen, last_seen}
    aggregates: dict[str, dict] = {}

    for row in rows:
        ke = row["key_entities"]
        if isinstance(ke, str):
            try:
                ke = json.loads(ke)
            except Exception:
                continue

        companies = ke.get("companies") or []
        if not isinstance(companies, list):
            continue

        item_date = row["item_date"]

        for raw_name in companies:
            if not isinstance(raw_name, str):
                continue
            raw_name = raw_name.strip()
            if _is_noise(raw_name):
                continue

            norm = _normalize(raw_name)
            if len(norm) < 3:
                continue

            if norm not in aggregates:
                aggregates[norm] = {
                    "name":       raw_name,      # keep first-seen casing
                    "norm":       norm,
                    "count":      0,
                    "first_seen": item_date,
                    "last_seen":  item_date,
                }
            else:
                agg = aggregates[norm]
                if item_date and (agg["first_seen"] is None or item_date < agg["first_seen"]):
                    agg["first_seen"] = item_date
                if item_date and (agg["last_seen"] is None or item_date > agg["last_seen"]):
                    agg["last_seen"] = item_date
            aggregates[norm]["count"] += 1

    if not aggregates:
        logger.info("entity_resolver: no entities to upsert")
        return 0

    rows_to_upsert = [
        (agg["name"], agg["norm"], agg["count"], agg["first_seen"], agg["last_seen"])
        for agg in aggregates.values()
    ]

    with conn.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO cvc.entities
                (name, name_normalized, mention_count, first_seen, last_seen, updated_at)
            VALUES %s
            ON CONFLICT (name_normalized) DO UPDATE SET
                mention_count = GREATEST(cvc.entities.mention_count, EXCLUDED.mention_count),
                first_seen    = LEAST(cvc.entities.first_seen, EXCLUDED.first_seen),
                last_seen     = GREATEST(cvc.entities.last_seen, EXCLUDED.last_seen),
                updated_at    = NOW()
            """,
            rows_to_upsert,
            template="(%s, %s, %s, %s, %s, NOW())",
        )
    conn.commit()

    logger.info(f"entity_resolver: upserted {len(rows_to_upsert)} entities")
    return len(rows_to_upsert)


# ── Phase 2: Resolve ──────────────────────────────────────────────────────────

def run_resolve(conn) -> int:
    """
    Match unresolved entities against cvc.companies by normalized name.
    Priority: exact match → fuzzy match (≥ MATCH_THRESHOLD).
    Sets company_id, resolved=TRUE, match_confidence, resolved_at.
    Returns count of newly resolved entities.
    """
    logger.info("entity_resolver: Phase 2 — resolving entities against companies...")

    # Load all companies: id + normalized name
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT id, name FROM cvc.companies WHERE name IS NOT NULL")
        company_rows = cur.fetchall()

    company_lookup: dict[str, int] = {}  # norm → company_id
    for row in company_rows:
        norm = _normalize(row["name"])
        if norm:
            company_lookup[norm] = row["id"]

    logger.info(f"entity_resolver: {len(company_lookup)} companies loaded for matching")

    # Load unresolved entities
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT id, name, name_normalized
            FROM cvc.entities
            WHERE NOT resolved
            ORDER BY mention_count DESC
        """)
        unresolved = cur.fetchall()

    logger.info(f"entity_resolver: {len(unresolved)} unresolved entities to process")

    resolved_count = 0
    company_norms = list(company_lookup.keys())

    updates = []  # (company_id, confidence, entity_id)
    no_match = []  # entity_ids that got resolved=True but no company

    for entity in unresolved:
        ent_norm = entity["name_normalized"]

        # 1. Exact match
        if ent_norm in company_lookup:
            updates.append((company_lookup[ent_norm], 1.0, entity["id"]))
            resolved_count += 1
            continue

        # 2. Fuzzy match — find best scoring company
        best_score = 0.0
        best_id: Optional[int] = None
        for comp_norm in company_norms:
            score = _similarity(ent_norm, comp_norm)
            if score > best_score:
                best_score = score
                best_id = company_lookup[comp_norm]

        if best_score >= MATCH_THRESHOLD and best_id is not None:
            updates.append((best_id, round(best_score, 3), entity["id"]))
            resolved_count += 1
        else:
            # Mark as resolved (attempted) even with no match — avoids re-processing
            no_match.append(entity["id"])

    # Write matches
    if updates:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(
                cur,
                """
                UPDATE cvc.entities SET
                    company_id       = data.company_id,
                    match_confidence = data.confidence,
                    resolved         = TRUE,
                    resolved_at      = NOW(),
                    updated_at       = NOW()
                FROM (VALUES %s) AS data(company_id, confidence, entity_id)
                WHERE cvc.entities.id = data.entity_id
                """,
                updates,
                template="(%s::int, %s::numeric, %s::int)",
                page_size=500,
            )

    # Mark no-match as resolved so we don't retry every run
    if no_match:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE cvc.entities SET
                    resolved    = TRUE,
                    resolved_at = NOW(),
                    updated_at  = NOW()
                WHERE id = ANY(%s)
                """,
                (no_match,),
            )

    conn.commit()

    logger.info(
        f"entity_resolver: resolved {resolved_count} matched, "
        f"{len(no_match)} marked resolved (no company match)"
    )
    return resolved_count


# ── Stats ─────────────────────────────────────────────────────────────────────

def print_stats(conn) -> None:
    """Print a quick summary of the entities table."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT
                COUNT(*)                                             AS total,
                COUNT(*) FILTER (WHERE company_id IS NOT NULL)      AS matched,
                COUNT(*) FILTER (WHERE resolved AND company_id IS NULL) AS no_match,
                COUNT(*) FILTER (WHERE NOT resolved)                AS pending,
                SUM(mention_count)                                  AS total_mentions,
                MAX(last_seen)                                      AS latest_signal
            FROM cvc.entities
        """)
        s = cur.fetchone()

        cur.execute("""
            SELECT e.name, e.mention_count, c.name AS company_name, e.match_confidence
            FROM cvc.entities e
            LEFT JOIN cvc.companies c ON c.id = e.company_id
            ORDER BY e.mention_count DESC
            LIMIT 15
        """)
        top = cur.fetchall()

    print(f"\nEntities table summary")
    print(f"  Total entities  : {s['total']}")
    print(f"  Matched → company: {s['matched']}")
    print(f"  No match found  : {s['no_match']}")
    print(f"  Pending resolve : {s['pending']}")
    print(f"  Total mentions  : {s['total_mentions']}")
    print(f"  Latest signal   : {s['latest_signal']}")
    print(f"\nTop 15 by mention count:")
    for row in top:
        company = row["company_name"] or "— (not in pipeline)"
        conf = f" [{row['match_confidence']:.2f}]" if row["match_confidence"] else ""
        print(f"  {row['mention_count']:4d}  {row['name']:<35s}  → {company}{conf}")


# ── Standalone ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Entity ingestion and resolution")
    parser.add_argument("--ingest-only",  action="store_true", help="Phase 1 only")
    parser.add_argument("--resolve-only", action="store_true", help="Phase 2 only")
    parser.add_argument("--stats",        action="store_true", help="Print table stats and exit")
    args = parser.parse_args()

    conn = psycopg2.connect(**DB_CONFIG, cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        if args.stats:
            print_stats(conn)
            return

        if not args.resolve_only:
            run_ingest(conn)

        if not args.ingest_only:
            run_resolve(conn)

        print_stats(conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
