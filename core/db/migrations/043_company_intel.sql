-- Migration 043 (company_intel) — SUPERSEDED
--
-- This migration originally created cvc.company_intel with columns
-- (source_type, source_url, source_filename, raw_content, signals, processed).
-- The canonical schema (intel_type, label, file_path, file_name, raw_text,
-- uploaded_at, uploaded_by) is defined in migration 052_company_intel.sql and
-- is what the API actually uses.
--
-- Running both migrations leaves cvc.company_intel with the wrong shape because
-- CREATE TABLE IF NOT EXISTS in 052 sees the table already exists and skips.
-- This file is intentionally a no-op so 052 can build the canonical table.

DO $$ BEGIN
    RAISE NOTICE 'Migration 043_company_intel is a no-op (superseded by 052_company_intel)';
END $$;
