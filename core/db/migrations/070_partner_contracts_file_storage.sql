-- Migration 070: Add file storage columns to partner_contracts
-- The existing table was created by the ingest_contracts.py worker with:
--   contract_status, services_subscribed (jsonb), expiry_date, file_link, raw_summary, contract_value
-- The API and UI need: title, term_start, term_end, value, summary, filename, file_type, file_data
-- This migration adds the missing columns so UI uploads work cleanly.

ALTER TABLE cvc.partner_contracts
  ADD COLUMN IF NOT EXISTS title      TEXT,
  ADD COLUMN IF NOT EXISTS term_start DATE,
  ADD COLUMN IF NOT EXISTS term_end   DATE,
  ADD COLUMN IF NOT EXISTS value      NUMERIC,
  ADD COLUMN IF NOT EXISTS summary    TEXT,
  ADD COLUMN IF NOT EXISTS filename   TEXT,
  ADD COLUMN IF NOT EXISTS file_type  TEXT,
  ADD COLUMN IF NOT EXISTS file_data  BYTEA,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill computed columns from existing ingest-script rows where possible
UPDATE cvc.partner_contracts
SET
  term_end = expiry_date,
  value    = contract_value,
  summary  = raw_summary
WHERE term_end IS NULL;

COMMENT ON COLUMN cvc.partner_contracts.file_data IS
'Binary contract file (PDF or DOCX). Stored directly in DB for UI download. Populated by POST /partners/{id}/contract upload endpoint.';
COMMENT ON COLUMN cvc.partner_contracts.title IS
'Human-readable contract title, e.g. "Cummins 2026 Innovation Partnership"';
COMMENT ON COLUMN cvc.partner_contracts.term_start IS
'Contract effective start date.';
COMMENT ON COLUMN cvc.partner_contracts.term_end IS
'Contract expiry/end date.';
