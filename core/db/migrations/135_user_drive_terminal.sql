-- Migration 135: Per-user Google Drive terminal
--
-- Each platform user connects their OWN Google Drive (individual OAuth), ingests
-- their own files into an isolated personal workspace ("My Terminal"), and the
-- platform makes sense of each file (doc type + summary + key points). All rows
-- are scoped by user_id so one person never sees another's Drive or documents.

-- One OAuth token per user. token_json is the google credentials JSON blob.
CREATE TABLE IF NOT EXISTS cvc.user_drive_tokens (
    user_id       int PRIMARY KEY REFERENCES cvc.users(id) ON DELETE CASCADE,
    token_json    text NOT NULL,
    google_email  text,                       -- the connected Google account email
    connected_at  timestamptz DEFAULT NOW(),
    updated_at    timestamptz DEFAULT NOW()
);

-- One row per ingested document, owned by a single user.
-- Extracted text lives on disk (text_path); the DB keeps the "sense" of it.
CREATE TABLE IF NOT EXISTS cvc.drive_documents (
    id            serial PRIMARY KEY,
    user_id       int NOT NULL REFERENCES cvc.users(id) ON DELETE CASCADE,
    drive_file_id text,                        -- Google Drive file id (for re-fetch / dedupe)
    filename      text NOT NULL,
    mime_type     text,
    doc_type      text DEFAULT 'unknown',      -- from the tagger (pitch_deck, financials, ...)
    chars         int  DEFAULT 0,
    conversion    text DEFAULT 'unknown',      -- ok | truncated | skipped | failed | download_failed
    text_path     text,                        -- path to extracted .txt on disk
    summary       text,                        -- the "sense" — short synopsis
    key_points    jsonb DEFAULT '[]'::jsonb,   -- extracted key bullet points
    ingested_at   timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drive_documents_user ON cvc.drive_documents(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_drive_documents_user_file
    ON cvc.drive_documents(user_id, drive_file_id);
