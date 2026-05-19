-- Migration 065: Add document_date to partner_documents for chronological sorting
ALTER TABLE cvc.partner_documents
    ADD COLUMN IF NOT EXISTS document_date DATE;
