-- Migration 058: Term sheets for invested deals
-- Stores CVC's deal terms when a company moves to invested status
-- Submitting a term sheet also sets is_portfolio=TRUE on the company

CREATE TABLE IF NOT EXISTS cvc.term_sheets (
  id                      SERIAL PRIMARY KEY,
  company_id              INTEGER NOT NULL REFERENCES cvc.companies(id) ON DELETE CASCADE,
  investment_type         TEXT,        -- SAFE, convertible_note, equity, warrant
  round_type              TEXT,        -- Pre-Seed, Seed, Series A, etc.
  check_size_usd          BIGINT,      -- CVC's check size
  pre_money_valuation_usd BIGINT,
  post_money_valuation_usd BIGINT,
  is_lead_investor        BOOLEAN NOT NULL DEFAULT FALSE,
  co_investors            TEXT[],
  board_seat              BOOLEAN NOT NULL DEFAULT FALSE,
  pro_rata_rights         BOOLEAN NOT NULL DEFAULT FALSE,
  close_date              DATE,
  lead_attorney           TEXT,
  notes                   TEXT,
  submitted_by            TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id)
);

COMMENT ON TABLE cvc.term_sheets IS 'Investment term sheets for companies CVC has invested in. Submitting one sets is_portfolio=TRUE on the company.';
