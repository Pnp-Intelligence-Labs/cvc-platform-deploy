-- Migration 087: Add cases_enriched_at to track when enrich_cases.py last ran
-- Used by the enrichment status endpoint to detect "worker ran but found nothing"
-- so the company profile poller doesn't spin indefinitely.

ALTER TABLE cvc.companies
    ADD COLUMN IF NOT EXISTS cases_enriched_at timestamptz;
