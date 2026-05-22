-- Migration 134: Add columns referenced in code but missing from schema
-- score_updated_at: tracks when company score was last recalculated
-- source_url on commercial_deployments: reference link for deployment record

ALTER TABLE cvc.companies
    ADD COLUMN IF NOT EXISTS score_updated_at TIMESTAMPTZ;

ALTER TABLE cvc.commercial_deployments
    ADD COLUMN IF NOT EXISTS source_url TEXT;
