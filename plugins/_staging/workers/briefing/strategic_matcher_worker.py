#!/usr/bin/env python3
"""
strategic_matcher_worker.py — Match content entities to CVC corporate partners.

Closes the gap between raw content mentions and CVC's advisory partner network.
Uses nomic-embed-text (Ollama, Refinery GPU) + pgvector cosine similarity.

Three phases:
  1. Embed partners  — generate 768-dim embeddings for all 36 partners
  2. Embed entities  — generate embeddings for all unembedded cvc.entities
  3. Match           — for each entity, find best partner by cosine similarity
                       above MATCH_THRESHOLD; write partner_id + confidence

Why embeddings instead of fuzzy string matching:
  "Walmart USA" → Walmart, "Honeywell Aerospace" → Honeywell,
  "Costco" → Costco Wholesale Corporation — all caught at 0.85 threshold.

Runs on Refinery (Ollama at localhost:11434).
DB is on Dell (host=100.83.104.117 from Refinery, localhost on Dell).

Standalone:
  PYTHONPATH=core python3 workers/briefing/strategic_matcher_worker.py
  python3 strategic_matcher_worker.py --embed-only
  python3 strategic_matcher_worker.py --match-only
  python3 strategic_matcher_worker.py --stats
"""

import os
import sys
import json
import logging
import argparse
import requests
import psycopg2
import psycopg2.extras
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

OLLAMA_URL         = os.environ.get("OLLAMA_URL", "http://localhost:11434")
EMBED_MODEL        = "mxbai-embed-large"
MATCH_THRESHOLD    = 0.82   # cosine similarity floor — catches variants like
                            # "Honeywell Aerospace" → Honeywell, "Walmart USA" → Walmart
EMBED_BATCH_SIZE   = 50     # entities per Ollama batch call


# ── Embedding ─────────────────────────────────────────────────────────────────

def embed_text(text: str) -> Optional[list[float]]:
    """Call Ollama nomic-embed-text for a single string. Returns None on failure."""
    try:
        resp = requests.post(
            f"{OLLAMA_URL}/api/embed",
            json={"model": EMBED_MODEL, "input": text},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()["embeddings"][0]
    except Exception as e:
        logger.warning(f"strategic_matcher: embed failed for '{text[:40]}': {e}")
        return None


def embed_batch(texts: list[str]) -> list[Optional[list[float]]]:
    """Embed a list of texts. Returns list of embeddings (None on failure per item)."""
    results = []
    for text in texts:
        results.append(embed_text(text))
    return results


# ── Phase 1: Embed partners ───────────────────────────────────────────────────

def embed_partners(conn) -> int:
    """Generate and store embeddings for all partners missing one."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT id, name FROM cvc.partners
            WHERE name_embedding IS NULL
            ORDER BY name
        """)
        partners = cur.fetchall()

    if not partners:
        logger.info("strategic_matcher: all partners already embedded")
        return 0

    logger.info(f"strategic_matcher: embedding {len(partners)} partners...")
    count = 0
    for p in partners:
        vec = embed_text(p["name"])
        if vec is None:
            continue
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE cvc.partners SET name_embedding = %s WHERE id = %s",
                (json.dumps(vec), p["id"]),
            )
        conn.commit()
        count += 1

    logger.info(f"strategic_matcher: {count} partner embeddings stored")
    return count


# ── Phase 2: Embed entities ───────────────────────────────────────────────────

def embed_entities(conn) -> int:
    """Generate and store embeddings for all entities missing one."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT id, name FROM cvc.entities
            WHERE name_embedding IS NULL
            ORDER BY mention_count DESC
        """)
        entities = cur.fetchall()

    if not entities:
        logger.info("strategic_matcher: all entities already embedded")
        return 0

    logger.info(f"strategic_matcher: embedding {len(entities)} entities...")
    count = 0

    for i in range(0, len(entities), EMBED_BATCH_SIZE):
        batch = entities[i:i + EMBED_BATCH_SIZE]
        for ent in batch:
            vec = embed_text(ent["name"])
            if vec is None:
                continue
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE cvc.entities SET name_embedding = %s WHERE id = %s",
                    (json.dumps(vec), ent["id"]),
                )
            count += 1

        conn.commit()
        if (i // EMBED_BATCH_SIZE + 1) % 5 == 0:
            logger.info(f"strategic_matcher: {count}/{len(entities)} entity embeddings done...")

    logger.info(f"strategic_matcher: {count} entity embeddings stored")
    return count


# ── Phase 3: Match entities to partners ──────────────────────────────────────

def match_entities(conn) -> int:
    """
    For each entity with an embedding, find the best partner match via
    pgvector cosine similarity. Updates partner_id + partner_confidence.
    Returns count of newly matched entities.
    """
    logger.info("strategic_matcher: running cosine similarity matching...")

    # Find best partner for each entity in one query
    # 1 - (a <=> b) converts cosine distance to cosine similarity
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(f"""
            SELECT DISTINCT ON (e.id)
                e.id        AS entity_id,
                p.id        AS partner_id,
                p.name      AS partner_name,
                e.name      AS entity_name,
                e.mention_count,
                1 - (e.name_embedding <=> p.name_embedding) AS similarity
            FROM cvc.entities e
            CROSS JOIN cvc.partners p
            WHERE e.name_embedding IS NOT NULL
              AND p.name_embedding IS NOT NULL
              AND 1 - (e.name_embedding <=> p.name_embedding) >= {MATCH_THRESHOLD}
            ORDER BY e.id, similarity DESC
        """)
        matches = cur.fetchall()

    if not matches:
        logger.info("strategic_matcher: no matches above threshold")
        return 0

    logger.info(f"strategic_matcher: {len(matches)} entity→partner matches found")

    # Write matches
    with conn.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            """
            UPDATE cvc.entities SET
                partner_id          = data.partner_id,
                partner_confidence  = data.similarity,
                updated_at          = NOW()
            FROM (VALUES %s) AS data(partner_id, similarity, entity_id)
            WHERE cvc.entities.id = data.entity_id
            """,
            [(m["partner_id"], round(float(m["similarity"]), 3), m["entity_id"]) for m in matches],
            template="(%s::int, %s::numeric, %s::int)",
        )
    conn.commit()

    return len(matches)


# ── Stats ─────────────────────────────────────────────────────────────────────

def print_stats(conn) -> None:
    """Print partner mention summary — the core deliverable of this module."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT
                p.name                    AS partner,
                COUNT(e.id)               AS entity_variants,
                SUM(e.mention_count)      AS total_mentions,
                MAX(e.mention_count)      AS peak_variant_mentions,
                MAX(e.last_seen)          AS latest_signal,
                MIN(e.partner_confidence) AS min_confidence
            FROM cvc.partners p
            JOIN cvc.entities e ON e.partner_id = p.id
            GROUP BY p.id, p.name
            ORDER BY total_mentions DESC
        """)
        rows = cur.fetchall()

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT
                COUNT(*) FILTER (WHERE partner_id IS NOT NULL) AS matched,
                COUNT(*) FILTER (WHERE partner_id IS NULL)     AS unmatched,
                COUNT(*) FILTER (WHERE name_embedding IS NULL) AS no_embedding,
                SUM(mention_count) FILTER (WHERE partner_id IS NOT NULL) AS partner_mentions
            FROM cvc.entities
        """)
        summary = cur.fetchone()

    print(f"\nStrategic Matcher — Partner Signal Summary")
    print(f"  Entities matched to a partner : {summary['matched']}")
    print(f"  Entities with no partner match: {summary['unmatched']}")
    print(f"  Total partner-linked mentions  : {summary['partner_mentions']}")
    print(f"\n{'Partner':<40} {'Variants':>8} {'Mentions':>9} {'Latest':>12} {'Min Conf':>9}")
    print("-" * 82)
    for r in rows:
        print(
            f"  {r['partner']:<38} {r['entity_variants']:>8} "
            f"{r['total_mentions']:>9} {str(r['latest_signal']):>12} "
            f"{float(r['min_confidence']):>9.3f}"
        )


# ── Standalone ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Strategic partner entity matcher")
    parser.add_argument("--embed-only",  action="store_true", help="Phases 1+2 only")
    parser.add_argument("--match-only",  action="store_true", help="Phase 3 only")
    parser.add_argument("--stats",       action="store_true", help="Print stats and exit")
    args = parser.parse_args()

    conn = psycopg2.connect(**DB_CONFIG, cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        if args.stats:
            print_stats(conn)
            return

        if not args.match_only:
            embed_partners(conn)
            embed_entities(conn)

        if not args.embed_only:
            match_entities(conn)

        print_stats(conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
