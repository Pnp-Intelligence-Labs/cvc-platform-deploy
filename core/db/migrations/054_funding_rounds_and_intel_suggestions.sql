-- Migration 054: funding rounds consolidation + intel suggestions
--
-- 1. Adds `approximate` and `notes` to cvc.funding_rounds so backfilled data
--    is distinguishable from verified rounds.
-- 2. Creates cvc.intel_suggestions — one row per suggested change derived from
--    analyst-uploaded intel. Tracks confidence, reasoning, and accept/reject
--    decisions so the system can learn calibration over time.

-- ── funding_rounds additions ───────────────────────────────────────────────
ALTER TABLE cvc.funding_rounds
    ADD COLUMN IF NOT EXISTS approximate  BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS notes        TEXT;

-- ── intel_suggestions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cvc.intel_suggestions (
    id               SERIAL PRIMARY KEY,
    company_id       INTEGER NOT NULL REFERENCES cvc.companies(id) ON DELETE CASCADE,
    intel_id         INTEGER REFERENCES cvc.company_intel(id) ON DELETE SET NULL,

    -- What kind of change is being suggested
    suggestion_type  TEXT NOT NULL CHECK (suggestion_type IN (
                         'new_funding_round',  -- new row in funding_rounds
                         'field_update',       -- update a field on cvc.companies
                         'new_investor'        -- add to investors array
                     )),

    -- For field_update: which field and what values
    field_name       TEXT,
    current_value    TEXT,
    suggested_value  TEXT,

    -- For structured data (new_funding_round, etc.)
    suggested_data   JSONB,

    -- Confidence and reasoning from the LLM
    confidence       NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    reasoning        TEXT,

    -- Review state
    status           TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'accepted', 'rejected')),
    reviewed_by      TEXT,
    reviewed_at      TIMESTAMPTZ,

    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_intel_suggestions_company   ON cvc.intel_suggestions (company_id, status);
CREATE INDEX idx_intel_suggestions_intel     ON cvc.intel_suggestions (intel_id);
CREATE INDEX idx_intel_suggestions_pending   ON cvc.intel_suggestions (status) WHERE status = 'pending';
