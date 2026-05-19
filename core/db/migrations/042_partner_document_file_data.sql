-- Migration 042: Store original file bytes in partner_documents
-- Previously only raw_text (extracted text) was stored; the original file was discarded.
-- Adding file_data BYTEA lets us serve the original file for download.
-- Documents uploaded before this migration will have file_data = NULL (not downloadable).

ALTER TABLE cvc.partner_documents
    ADD COLUMN IF NOT EXISTS file_data BYTEA;

COMMENT ON COLUMN cvc.partner_documents.file_data IS
'Original file bytes. NULL for documents uploaded before migration 042. '
'Used by GET /partners/{id}/documents/{doc_id}/download.';
