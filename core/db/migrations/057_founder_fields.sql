-- Migration 057: Add structured founder fields to companies table
-- founders: JSONB array of {name, role, linkedin, prior_companies:[{name, role, exit_type, acquirer, year, deal_size_usd}]}
-- is_repeat_founder: true if any founder has founded/led a prior company
-- prior_exit_count: total verified acquisitions or IPOs across all founders

ALTER TABLE cvc.companies
  ADD COLUMN IF NOT EXISTS founders JSONB,
  ADD COLUMN IF NOT EXISTS is_repeat_founder BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS prior_exit_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN cvc.companies.founders IS 'Structured founder data: [{name, role, linkedin, prior_companies:[{name, role, exit_type, acquirer, year, deal_size_usd}]}]';
COMMENT ON COLUMN cvc.companies.is_repeat_founder IS 'True if any founder has previously founded or led another company';
COMMENT ON COLUMN cvc.companies.prior_exit_count IS 'Total verified acquisitions or IPOs across all founders';
