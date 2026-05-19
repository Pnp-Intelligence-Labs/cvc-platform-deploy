-- Migration 118: partner_collections
-- A curated list of startups. Either part of a dealflow (dealflow_id set)
-- or standalone (dealflow_id null — for partners who pay for collection-only service).

CREATE TABLE IF NOT EXISTS cvc.partner_collections (
    id           SERIAL PRIMARY KEY,
    partner_id   INTEGER NOT NULL REFERENCES cvc.partners(id) ON DELETE CASCADE,
    dealflow_id  INTEGER REFERENCES cvc.partner_dealflows(id) ON DELETE CASCADE, -- null = standalone
    display_id   TEXT,                        -- e.g. DF-2026-001-A or COL-2026-001
    title        TEXT,
    status       TEXT NOT NULL DEFAULT 'draft',-- draft / sent / shortlisted / complete
    notes        TEXT,
    created_by   TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE  cvc.partner_collections             IS 'Curated startup lists. Standalone or part of a dealflow.';
COMMENT ON COLUMN cvc.partner_collections.dealflow_id IS 'NULL = standalone collection (no dealflow parent).';
COMMENT ON COLUMN cvc.partner_collections.display_id  IS 'DF-YYYY-NNN-A for dealflow collections, COL-YYYY-NNN for standalone.';
COMMENT ON COLUMN cvc.partner_collections.status      IS 'draft → sent → shortlisted → complete';
