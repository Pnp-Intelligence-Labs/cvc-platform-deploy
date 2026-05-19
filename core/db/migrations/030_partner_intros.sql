-- Migration 030: Partner intro metrics on cvc.companies
-- Populated by workers/import/import_intros.py from "2025 Tech Data - 2025 Intros.csv"
-- Each row in that CSV = one startup introduction to a corporate partner.

ALTER TABLE cvc.companies
    ADD COLUMN IF NOT EXISTS intro_count      INT     DEFAULT 0,
    ADD COLUMN IF NOT EXISTS intro_partners   JSONB   DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS last_intro_date  DATE;

-- Index for sorting/filtering by engagement depth
CREATE INDEX IF NOT EXISTS idx_companies_intro_count
    ON cvc.companies(intro_count DESC)
    WHERE intro_count > 0;
