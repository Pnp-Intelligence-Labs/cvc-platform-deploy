-- Migration: 003_enrichment.sql
-- Adds enrichment tracking fields for data quality system

-- ── Add enrichment columns to companies table ─────────────────────────────────
ALTER TABLE cvc.companies 
    ADD COLUMN IF NOT EXISTS enrichment_status VARCHAR(50) DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS enrichment_confidence FLOAT,
    ADD COLUMN IF NOT EXISTS enrichment_source VARCHAR(50),
    ADD COLUMN IF NOT EXISTS predicted_subsector VARCHAR(100);

-- ── Indexes for enrichment queries ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cvc_companies_enrichment_status 
    ON cvc.companies(enrichment_status);

CREATE INDEX IF NOT EXISTS idx_cvc_companies_subsector_null 
    ON cvc.companies(subsector) WHERE subsector IS NULL;
