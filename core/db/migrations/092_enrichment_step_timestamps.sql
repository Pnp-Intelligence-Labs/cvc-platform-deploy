-- Migration 092: per-step enrichment timestamps
-- founder_enriched_at and fourd_enriched_at let the UI know a step ran
-- even when no data was written (e.g. no founders found, 4D already up to date).

ALTER TABLE cvc.companies
    ADD COLUMN IF NOT EXISTS founder_enriched_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS fourd_enriched_at   TIMESTAMPTZ;
