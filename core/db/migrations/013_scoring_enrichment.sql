-- Migration 013: Scoring enrichment columns
-- Adds structured data columns for enriched scoring methodology

-- Patent signals from USPTO
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS patent_count INTEGER DEFAULT 0;
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS patent_recency TEXT; -- 'recent' (≤2yr), 'moderate' (≤5yr), 'old', 'none'
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS patent_ipc_codes TEXT[] DEFAULT '{}';

-- Funding structure (inferred from total_raised_usd + stage)
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS funding_rounds JSONB DEFAULT '[]';
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS lead_investors TEXT[] DEFAULT '{}';
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS investor_tier TEXT; -- 'top_tier', 'mid_tier', 'emerging', 'unknown'

-- Commercial signals
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS commercial_signals JSONB DEFAULT '{}';
-- e.g. {"has_enterprise_customers": true, "enterprise_deployment": false, "product_available": true, "revenue_evidence": "moderate"}

-- Enrichment metadata
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS phase2_enriched_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS scoring_data JSONB DEFAULT '{}';
-- Raw data used for last scoring run

-- Index for finding companies needing phase 2 enrichment
CREATE INDEX IF NOT EXISTS idx_companies_phase2 ON cvc.companies (enrichment_status)
  WHERE phase2_enriched_at IS NULL AND enrichment_status IN ('enriched', 'auto_filled');
