"""
core/pnpbert/cache.py — persistent embedding cache for the PnPbert recommender.

Encoding documents with sentence-transformers is the dominant request cost.
Documents are effectively static, so each text's vector is cached by SHA-256
hash across two layers:

    in-memory dict  →  cvc.pnpbert_embeddings (Postgres)  →  encode (model)

A request only encodes texts missing from BOTH layers (after warmup, typically
none), turning per-request latency from "encode N documents" into "fetch cached
vectors + numpy MaxSim".

The cache is storage-agnostic about where its connection comes from: it takes a
`conn_factory` — any callable returning a context-manager DB connection (e.g.
core.db.connection.get_connection) — so the engine package stays decoupled from
the app's DB wiring.
"""
import hashlib

import numpy as np
import psycopg2
import psycopg2.extras

MODEL_NAME = "all-MiniLM-L6-v2"


class EmbeddingCache:
    def __init__(self, conn_factory, model_name: str = MODEL_NAME) -> None:
        self._conn_factory = conn_factory
        self._model_name = model_name
        self._mem: dict[str, np.ndarray] = {}

    @staticmethod
    def _hash(text: str) -> str:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    def encode(self, texts: list[str], model) -> np.ndarray:
        """
        Return an (len(texts), dim) float32 matrix of L2-normalised embeddings,
        served from cache where possible and encoded with `model` only for misses.
        Order matches `texts`; duplicate texts are encoded once.
        """
        hashes = [self._hash(t) for t in texts]

        # Anything not already in memory is a candidate miss.
        need = {h: t for h, t in zip(hashes, texts) if h not in self._mem}
        if need:
            self._mem.update(self._db_fetch(list(need)))
            to_encode = {h: t for h, t in need.items() if h not in self._mem}
            if to_encode:
                keys = list(to_encode)
                vecs = np.asarray(
                    model.encode(
                        [to_encode[h] for h in keys],
                        normalize_embeddings=True,
                        show_progress_bar=False,
                    ),
                    dtype=np.float32,
                )
                fresh = dict(zip(keys, vecs))
                self._mem.update(fresh)
                self._db_store(fresh)

        return np.vstack([self._mem[h] for h in hashes]).astype(np.float32)

    # ------------------------------------------------------------------
    # Postgres layer
    # ------------------------------------------------------------------

    def _db_fetch(self, hashes: list[str]) -> dict[str, np.ndarray]:
        if not hashes:
            return {}
        with self._conn_factory() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT text_hash, vector FROM cvc.pnpbert_embeddings "
                    "WHERE model = %s AND text_hash = ANY(%s)",
                    [self._model_name, hashes],
                )
                rows = cur.fetchall()
        out: dict[str, np.ndarray] = {}
        for r in rows:
            # RealDictCursor → dict; vector is a memoryview/bytes of float32 bytes
            out[r["text_hash"]] = np.frombuffer(bytes(r["vector"]), dtype=np.float32)
        return out

    def _db_store(self, mapping: dict[str, np.ndarray]) -> None:
        if not mapping:
            return
        rows = [
            (h, self._model_name, int(v.shape[0]), psycopg2.Binary(v.astype(np.float32).tobytes()))
            for h, v in mapping.items()
        ]
        with self._conn_factory() as conn:
            with conn.cursor() as cur:
                psycopg2.extras.execute_values(
                    cur,
                    "INSERT INTO cvc.pnpbert_embeddings (text_hash, model, dim, vector) "
                    "VALUES %s ON CONFLICT (model, text_hash) DO NOTHING",
                    rows,
                )
