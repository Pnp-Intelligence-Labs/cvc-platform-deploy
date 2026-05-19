-- Migration 079: strategic_matcher — pgvector embeddings for partner signal tracking
--
-- Adds embedding columns to cvc.partners and cvc.entities so the strategic
-- matcher worker can resolve entity mentions to CVC corporate partners via
-- cosine similarity (nomic-embed-text, 768-dim).
--
-- Also adds partner_id FK on entities so resolved matches persist.
-- Additive — no existing data modified.
--
-- LOCAL DEV: this migration silently skips the vector columns/index when the
-- pgvector extension isn't available on the host. Production must have pgvector
-- installed. The partner_id FK + partner_confidence still apply either way.

DO $strategic_matcher$
DECLARE
    has_vector BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_available_extensions WHERE name = 'vector'
    ) INTO has_vector;

    IF has_vector THEN
        EXECUTE 'CREATE EXTENSION IF NOT EXISTS vector';
        EXECUTE 'ALTER TABLE cvc.partners ADD COLUMN IF NOT EXISTS name_embedding vector(1024)';
        EXECUTE 'ALTER TABLE cvc.entities ADD COLUMN IF NOT EXISTS name_embedding vector(1024)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_partners_name_embedding
                 ON cvc.partners USING hnsw (name_embedding vector_cosine_ops)';
    ELSE
        RAISE NOTICE 'pgvector extension not available — skipping vector columns/index for local dev';
    END IF;
END;
$strategic_matcher$;

-- Always add partner resolution columns (FK only — no vector dependency)
ALTER TABLE cvc.entities
    ADD COLUMN IF NOT EXISTS partner_id         INTEGER REFERENCES cvc.partners(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS partner_confidence NUMERIC(4,3);

CREATE INDEX IF NOT EXISTS idx_entities_partner_id
    ON cvc.entities(partner_id)
    WHERE partner_id IS NOT NULL;
