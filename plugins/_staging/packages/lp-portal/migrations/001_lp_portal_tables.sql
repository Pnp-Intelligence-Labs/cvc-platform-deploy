-- LP Portal plugin migration 001
-- Core tables (fund_metrics, fund_nav_history, term_sheet_followons) are created
-- by core migrations 033 and 082. This migration ensures the plugin-specific
-- fund column and followons table exist for teams that deployed before 082.

-- fund_nav_history — created in core migration 082
CREATE TABLE IF NOT EXISTS cvc.fund_nav_history (
    id               SERIAL PRIMARY KEY,
    period_date      DATE NOT NULL,
    unrealized_fmv   NUMERIC NOT NULL,
    invested_capital NUMERIC NOT NULL,
    tvpi             NUMERIC,
    fund             TEXT DEFAULT 'Fund I'
);

-- term_sheet_followons — created in core migration 082
CREATE TABLE IF NOT EXISTS cvc.term_sheet_followons (
    id              SERIAL PRIMARY KEY,
    company_id      INTEGER NOT NULL REFERENCES cvc.companies(id) ON DELETE CASCADE,
    investment_date DATE NOT NULL,
    amount_usd      NUMERIC NOT NULL,
    followon_type   TEXT DEFAULT 'pro_rata',
    notes           TEXT,
    fund            TEXT DEFAULT 'Fund I',
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Ensure fund column exists on fund_nav_history (idempotent)
ALTER TABLE cvc.fund_nav_history ADD COLUMN IF NOT EXISTS fund TEXT DEFAULT 'Fund I';

-- Ensure fund + extended columns exist on term_sheets
ALTER TABLE cvc.term_sheets ADD COLUMN IF NOT EXISTS fund TEXT;
ALTER TABLE cvc.term_sheets ADD COLUMN IF NOT EXISTS fmv_usd NUMERIC;
ALTER TABLE cvc.term_sheets ADD COLUMN IF NOT EXISTS moic NUMERIC;
ALTER TABLE cvc.term_sheets ADD COLUMN IF NOT EXISTS is_written_off BOOLEAN DEFAULT false;
ALTER TABLE cvc.term_sheets ADD COLUMN IF NOT EXISTS category_2 TEXT;
ALTER TABLE cvc.term_sheets ADD COLUMN IF NOT EXISTS round_size_usd BIGINT;
ALTER TABLE cvc.term_sheets ADD COLUMN IF NOT EXISTS lead_investor TEXT;
ALTER TABLE cvc.term_sheets ADD COLUMN IF NOT EXISTS pre_money_valuation_usd BIGINT;
ALTER TABLE cvc.term_sheets ADD COLUMN IF NOT EXISTS investment_type TEXT;
ALTER TABLE cvc.term_sheets ADD COLUMN IF NOT EXISTS co_investors TEXT[];
