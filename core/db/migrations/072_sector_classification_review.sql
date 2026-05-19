-- Migration 072: sector classification review fields
-- Adds secondary_sector, sector_confidence, sector_rationale to companies.
-- Enables LLM-assigned classifications to be reviewed and confirmed by analysts.

ALTER TABLE cvc.companies
    ADD COLUMN IF NOT EXISTS secondary_sector    text,
    ADD COLUMN IF NOT EXISTS sector_confidence   integer CHECK (sector_confidence BETWEEN 1 AND 100),
    ADD COLUMN IF NOT EXISTS sector_rationale    text,
    ADD COLUMN IF NOT EXISTS sector_reviewed_by  text,
    ADD COLUMN IF NOT EXISTS sector_reviewed_at  timestamptz;

COMMENT ON COLUMN cvc.companies.sector_confidence  IS '1–100 LLM confidence in primary sector assignment';
COMMENT ON COLUMN cvc.companies.sector_rationale   IS 'LLM reasoning for sector + secondary_sector assignment';
COMMENT ON COLUMN cvc.companies.sector_reviewed_by IS 'Analyst username who confirmed or overrode the classification';
COMMENT ON COLUMN cvc.companies.sector_reviewed_at IS 'Timestamp of analyst review';
