-- Industrial Matrix plugin migration 001
-- The industrial matrix reads cvc.companies and cvc.funding_rounds, both of
-- which are created by core migrations. This migration ensures the enrichment
-- columns used by the matrix scoring exist on those tables.

-- Enrichment columns the matrix reads for scoring
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS enrichment_status    TEXT DEFAULT 'pending';
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS subsector            TEXT;
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS industrial_score     NUMERIC;
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS protocol_support     TEXT[];
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS certifications       TEXT[];
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS commercial_signals   JSONB;
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS d_score              NUMERIC;
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS i_score              NUMERIC;
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS m_score              NUMERIC;
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS a_score              NUMERIC;
