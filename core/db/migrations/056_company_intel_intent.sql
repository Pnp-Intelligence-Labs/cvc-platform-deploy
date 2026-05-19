-- Migration 056: Add intent column to company_intel
-- Stores analyst-specified extraction directives (e.g. ['funding', 'commercial_deployment'])
-- Used by process_intel.py to focus LLM extraction on the right suggestion types

ALTER TABLE cvc.company_intel
    ADD COLUMN IF NOT EXISTS intent text[] NOT NULL DEFAULT '{}';
