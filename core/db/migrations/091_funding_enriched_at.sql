-- Migration 091: funding_enriched_at timestamp
-- Stamps when enrich_funding_rounds.py last ran for a company,
-- regardless of whether rounds were found. Lets the UI poll resolve
-- even when no funding data exists.

ALTER TABLE cvc.companies
    ADD COLUMN IF NOT EXISTS funding_enriched_at TIMESTAMPTZ;
