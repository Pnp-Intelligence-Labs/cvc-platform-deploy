-- Migration 061: Brave search templates + execution log
-- Templates make queries configurable from the Admin UI.
-- Log records every search so we can track hit rates and improve over time.

CREATE TABLE IF NOT EXISTS cvc.brave_search_templates (
  id             SERIAL PRIMARY KEY,
  search_type    TEXT NOT NULL,          -- 'news', 'funding', 'product', 'case_studies'
  label          TEXT NOT NULL,          -- human-readable display name
  query_template TEXT NOT NULL,          -- use {name} as placeholder for company name
  result_count   INT  NOT NULL DEFAULT 5,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cvc.brave_search_log (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER REFERENCES cvc.companies(id) ON DELETE CASCADE,
  search_type   TEXT NOT NULL,
  template_id   INTEGER REFERENCES cvc.brave_search_templates(id) ON DELETE SET NULL,
  query         TEXT NOT NULL,
  result_count  INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_brave_search_log_company    ON cvc.brave_search_log(company_id);
CREATE INDEX idx_brave_search_log_type       ON cvc.brave_search_log(search_type);
CREATE INDEX idx_brave_search_log_created_at ON cvc.brave_search_log(created_at DESC);

-- Seed default templates (current hardcoded queries)
INSERT INTO cvc.brave_search_templates (search_type, label, query_template, result_count, notes) VALUES
  ('news',         'News & Announcements',     '"{name}" news press coverage announcement 2024 2025 2026', 5, 'Recent coverage — results written directly to companies.news_articles'),
  ('funding',      'Funding & Investors',       '"{name}" funding raised investment round investors',       5, 'Goes to LLM context only — funding rounds use enrich_funding_rounds.py'),
  ('product',      'Product & Technology',      '"{name}" product technology robotics automation',          5, 'Goes to LLM context for 4D classification'),
  ('case_studies', 'Case Studies & Deployments','"{name}" case study customer deployment success ROI',      5, 'Results queued to Human Review before writing to companies.case_studies')
ON CONFLICT DO NOTHING;
