-- Migration 078: cvc.entities — named entity discovery and resolution layer
--
-- Bridge between raw content mentions and the known company pipeline.
-- Entities are extracted from content_items.key_entities by entity_resolver.py.
-- company_id is NULL for discovered-but-not-yet-in-pipeline companies.
-- Additive — no existing tables modified.

CREATE TABLE IF NOT EXISTS cvc.entities (
    id               SERIAL PRIMARY KEY,
    name             TEXT NOT NULL,
    name_normalized  TEXT NOT NULL UNIQUE,   -- lowercase, no punctuation — dedup key
    entity_type      TEXT NOT NULL DEFAULT 'company',
    company_id       INTEGER REFERENCES cvc.companies(id) ON DELETE SET NULL,
    mention_count    INTEGER NOT NULL DEFAULT 0,
    first_seen       DATE,
    last_seen        DATE,
    resolved         BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at      TIMESTAMPTZ,
    match_confidence NUMERIC(4,3),           -- 1.000 = exact, 0.850+ = fuzzy
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup for resolution and momentum queries
CREATE INDEX IF NOT EXISTS idx_entities_company_id  ON cvc.entities(company_id);
CREATE INDEX IF NOT EXISTS idx_entities_unresolved  ON cvc.entities(resolved) WHERE NOT resolved;
CREATE INDEX IF NOT EXISTS idx_entities_last_seen   ON cvc.entities(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_entities_mention_count ON cvc.entities(mention_count DESC);
