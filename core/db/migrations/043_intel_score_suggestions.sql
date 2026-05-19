-- Migration 043 (intel_score_suggestions) — SUPERSEDED
--
-- This migration originally created cvc.company_intel, cvc.score_suggestions,
-- and cvc.company_activity_log with UUID-typed company_id. That was incompatible
-- with cvc.companies.id (INTEGER), so the migration could never apply.
--
-- The canonical schemas are:
--   • cvc.company_intel        → migration 052_company_intel.sql (INTEGER company_id)
--   • cvc.company_activity_log → migration 050_company_activity_log.sql
--
-- This migration is intentionally a no-op so the migration runner can apply
-- the full sequence cleanly.

DO $$ BEGIN
    RAISE NOTICE 'Migration 043_intel_score_suggestions is a no-op (superseded by 050 and 052)';
END $$;
