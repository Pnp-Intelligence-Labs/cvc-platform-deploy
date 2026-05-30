-- 136_pnpbert_embedding_cache.sql — persistent embedding cache for PnPbert.
--
-- The recommender (core/pnpbert/engine.py) encodes document facets with
-- sentence-transformers. Encoding is the dominant request cost. Documents are
-- effectively static, so we cache each text's vector keyed by its SHA-256 hash
-- and reuse it across requests and restarts. Only the small per-request query
-- and genuinely new/changed documents are ever re-encoded.
--
-- Vectors are stored as raw little-endian float32 bytes (BYTEA); a 384-dim
-- MiniLM vector is 1536 bytes. Idempotent.

CREATE TABLE IF NOT EXISTS cvc.pnpbert_embeddings (
    text_hash   TEXT        NOT NULL,
    model       TEXT        NOT NULL DEFAULT 'all-MiniLM-L6-v2',
    dim         INTEGER     NOT NULL,
    vector      BYTEA       NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (model, text_hash)
);
