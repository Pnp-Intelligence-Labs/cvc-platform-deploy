-- Migration 076: Revenue tracking on cvc.companies
-- Stores a point-in-time ARR / run-rate figure with period and source URL.

ALTER TABLE cvc.companies
    ADD COLUMN IF NOT EXISTS revenue_arr_usd  BIGINT,
    ADD COLUMN IF NOT EXISTS revenue_period   TEXT,   -- e.g. "H1 2025", "Q1 2026", "as of Jan 2026"
    ADD COLUMN IF NOT EXISTS revenue_source   TEXT;   -- URL where this figure was cited
