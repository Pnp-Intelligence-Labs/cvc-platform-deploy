-- Migration 030: Add intel_sources JSONB column to cvc.companies
-- Stores source citations for industrial intelligence

ALTER TABLE cvc.companies
    ADD COLUMN IF NOT EXISTS intel_sources JSONB;
