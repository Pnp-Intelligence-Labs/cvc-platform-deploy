-- Migration 082: Fund I LP schema
-- Adds fund_nav_history, term_sheet_followons, and extends term_sheets + fund_metrics
-- for the Fund I portfolio view and LP tab overhaul (applied 2026-04-27)

-- ── New table: cvc.fund_nav_history ──────────────────────────────────────────
-- Monthly NAV snapshots for the TVPI chart on the LP tab
CREATE TABLE IF NOT EXISTS cvc.fund_nav_history (
    id              SERIAL PRIMARY KEY,
    period_date     DATE NOT NULL,
    unrealized_fmv  NUMERIC NOT NULL,
    invested_capital NUMERIC NOT NULL,
    tvpi            NUMERIC,
    fund            TEXT DEFAULT 'Fund I'
);

-- ── New table: cvc.term_sheet_followons ──────────────────────────────────────
-- Follow-on investment records per company (separate from the initial term sheet)
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

-- ── Extend cvc.term_sheets ────────────────────────────────────────────────────
-- Deal data columns loaded from Fund Portfolio CSV
ALTER TABLE cvc.term_sheets
    ADD COLUMN IF NOT EXISTS round_size_usd           BIGINT,
    ADD COLUMN IF NOT EXISTS shares_purchased          INTEGER,
    ADD COLUMN IF NOT EXISTS pps_usd                   NUMERIC,
    ADD COLUMN IF NOT EXISTS stage_at_investment       TEXT,
    ADD COLUMN IF NOT EXISTS lead_investor             TEXT,
    ADD COLUMN IF NOT EXISTS revenue_at_investment_usd BIGINT,
    ADD COLUMN IF NOT EXISTS fmv_usd                   NUMERIC,
    ADD COLUMN IF NOT EXISTS moic                      NUMERIC,
    ADD COLUMN IF NOT EXISTS fund                      TEXT,
    ADD COLUMN IF NOT EXISTS is_written_off            BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS category_2                TEXT;

-- ── Extend cvc.fund_metrics ────────────────────────────────────────────────────
-- Fund structure breakdown columns (from Fund Portfolio CSV summary rows)
ALTER TABLE cvc.fund_metrics
    ADD COLUMN IF NOT EXISTS fund_size_usd           NUMERIC,
    ADD COLUMN IF NOT EXISTS management_fees_usd     NUMERIC,
    ADD COLUMN IF NOT EXISTS initial_investments_usd NUMERIC,
    ADD COLUMN IF NOT EXISTS followon_investments_usd NUMERIC,
    ADD COLUMN IF NOT EXISTS remaining_reserves_usd  NUMERIC;

-- ── Extend cvc.companies ─────────────────────────────────────────────────────
-- fund tag (e.g. 'Fund I') for filtering portfolio grid and LP counts
ALTER TABLE cvc.companies
    ADD COLUMN IF NOT EXISTS fund TEXT;

-- ── fund_metrics: net_irr is nullable (not derivable from CSV) ────────────────
ALTER TABLE cvc.fund_metrics ALTER COLUMN net_irr DROP NOT NULL;
