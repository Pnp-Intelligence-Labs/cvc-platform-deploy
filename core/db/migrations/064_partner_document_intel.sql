-- Migration 064: Add LLM-extracted intel fields to partner_documents
ALTER TABLE cvc.partner_documents
    ADD COLUMN IF NOT EXISTS summary TEXT,
    ADD COLUMN IF NOT EXISTS extracted_intel JSONB;
