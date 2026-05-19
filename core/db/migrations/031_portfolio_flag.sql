-- Migration 031: Portfolio company flag and enrichment columns
-- is_portfolio marks companies that are actual CVC portfolio investments
-- Populated by workers/import/import_portfolio.py from SLAM-Portco.csv

ALTER TABLE cvc.companies
    ADD COLUMN IF NOT EXISTS is_portfolio          BOOLEAN  DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS case_study            TEXT,
    ADD COLUMN IF NOT EXISTS competitive_advantage TEXT,
    ADD COLUMN IF NOT EXISTS background            TEXT,
    ADD COLUMN IF NOT EXISTS latest_investment_date DATE;

CREATE INDEX IF NOT EXISTS idx_companies_is_portfolio
    ON cvc.companies(is_portfolio)
    WHERE is_portfolio = TRUE;
