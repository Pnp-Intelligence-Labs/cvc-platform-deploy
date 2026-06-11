-- Migration 142: Durable storage + tab classification for ingested Drive docs
--
-- Previously the extracted text lived ONLY on disk (text_path) — lost on every
-- redeploy of an ephemeral-filesystem host (Railway). The text now lives in the
-- DB; disk is just a staging cache. target_tab records which platform tab the
-- ingestion classifier routed the document to (see core/drive/classifier.py).

ALTER TABLE cvc.drive_documents
    ADD COLUMN IF NOT EXISTS content_text text;

ALTER TABLE cvc.drive_documents
    ADD COLUMN IF NOT EXISTS target_tab text DEFAULT 'home';

ALTER TABLE cvc.drive_documents
    ADD COLUMN IF NOT EXISTS target_confidence text;

ALTER TABLE cvc.drive_documents
    ADD COLUMN IF NOT EXISTS target_reason text;

CREATE INDEX IF NOT EXISTS idx_drive_documents_target_tab
    ON cvc.drive_documents(target_tab);
