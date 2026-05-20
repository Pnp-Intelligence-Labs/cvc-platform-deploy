-- Migration 131: Add MinIO storage columns to partner_documents and partner_contracts
--
-- New uploads will be stored in MinIO object storage.
-- Existing rows default to storage_backend='db' so the old bytea column
-- (file_data) continues to serve downloads without any data migration.
--
-- storage_backend values:
--   'db'    → file bytes live in the file_data bytea column (legacy)
--   'minio' → file bytes live in MinIO; storage_key holds the object key
--
-- Safe to re-run (all IF NOT EXISTS / idempotent).

ALTER TABLE cvc.partner_documents
    ADD COLUMN IF NOT EXISTS storage_backend TEXT NOT NULL DEFAULT 'db',
    ADD COLUMN IF NOT EXISTS storage_key     TEXT;

COMMENT ON COLUMN cvc.partner_documents.storage_backend IS
'"db" = bytes in file_data bytea (legacy). "minio" = bytes in MinIO object storage.';
COMMENT ON COLUMN cvc.partner_documents.storage_key IS
'MinIO object key when storage_backend = ''minio''. NULL for legacy db-stored documents.';

ALTER TABLE cvc.partner_contracts
    ADD COLUMN IF NOT EXISTS storage_backend TEXT NOT NULL DEFAULT 'db',
    ADD COLUMN IF NOT EXISTS storage_key     TEXT;

COMMENT ON COLUMN cvc.partner_contracts.storage_backend IS
'"db" = bytes in file_data bytea (legacy). "minio" = bytes in MinIO object storage.';
COMMENT ON COLUMN cvc.partner_contracts.storage_key IS
'MinIO object key when storage_backend = ''minio''. NULL for legacy db-stored contracts.';
