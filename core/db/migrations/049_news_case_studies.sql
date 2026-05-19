-- Migration 049: Add news_articles and case_studies columns
-- Populated by enrich_deep.py during deep enrichment runs

ALTER TABLE cvc.companies
  ADD COLUMN IF NOT EXISTS news_articles JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS case_studies  JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN cvc.companies.news_articles IS
  'Auto-discovered press/media coverage. Populated by enrich_deep.py. '
  'Schema: [{title, url, snippet, age}]';

COMMENT ON COLUMN cvc.companies.case_studies IS
  'Auto-discovered customer deployments and case studies. Populated by enrich_deep.py. '
  'Schema: [{title, url, snippet, age}]';
