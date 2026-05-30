#!/usr/bin/env python3
"""
scripts/warmup_embeddings.py — Precompute PnPbert document embeddings.

Encodes the facet text of every company once and stores the vectors in
cvc.pnpbert_embeddings, so the first /recommendations request after a deploy or
restart is already fast instead of paying a cold encode.

Run after importing data or after a bulk enrichment that changes company text:

    python3 scripts/warmup_embeddings.py

Idempotent and incremental — texts already cached are skipped (the encoder is
only invoked for new/changed facets).
"""
import os
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "core"))

env_file = REPO / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())

from core.db.connection import get_connection
from core.pnpbert.cache import EmbeddingCache
from core.pnpbert.engine import PnPbert
from api.routes.recommendations import _startup_doc

BATCH = 256


def main() -> None:
    engine = PnPbert(cache=EmbeddingCache(get_connection))
    if not engine._try_load_encoder():
        sys.exit("sentence-transformers unavailable — nothing to warm (TF-IDF fallback is corpus-relative and not cached).")
    model = engine._encoder
    cache = engine._cache

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, name, sector, subsector, stage, one_liner, description, news_articles
                FROM cvc.companies
            """)
            rows = [dict(r) for r in cur.fetchall()]

    # Flatten every company's facets into one deduplicated text list
    texts: list[str] = []
    for r in rows:
        texts.extend(_startup_doc(r))
    unique = list(dict.fromkeys(texts))
    print(f"{len(rows)} companies → {len(texts)} facets ({len(unique)} unique). Encoding misses...")

    t0 = time.time()
    for i in range(0, len(unique), BATCH):
        chunk = unique[i : i + BATCH]
        cache.encode(chunk, model)
        print(f"  {min(i + BATCH, len(unique))}/{len(unique)}", end="\r")
    print()

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) AS n FROM cvc.pnpbert_embeddings")
            total = cur.fetchone()["n"]
    print(f"Done in {time.time() - t0:.1f}s. Cache now holds {total} vectors.")


if __name__ == "__main__":
    main()
