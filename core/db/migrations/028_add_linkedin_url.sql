-- Add LinkedIn URL enrichment support to companies table
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS linkedin_enrichment_attempts INTEGER DEFAULT 0;
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS linkedin_enriched_at TIMESTAMP;

-- Index for efficient querying of companies needing enrichment
CREATE INDEX IF NOT EXISTS idx_companies_linkedin_enrichment 
ON cvc.companies(website, linkedin_url, linkedin_enrichment_attempts) 
WHERE website IS NOT NULL AND linkedin_url IS NULL;