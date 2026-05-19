-- Migration 033: Partner document ingestion + notes
-- Isolated from startup/company tables — no cross-joins

CREATE TABLE IF NOT EXISTS cvc.partner_documents (
    id          SERIAL PRIMARY KEY,
    partner_id  INTEGER NOT NULL REFERENCES cvc.partners(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    file_type   TEXT NOT NULL,  -- 'pdf', 'docx', 'txt'
    raw_text    TEXT,
    source_label TEXT,          -- user-supplied label e.g. "Q1 2026 Deck"
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    parsed      BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_partner_documents_partner_id
    ON cvc.partner_documents(partner_id);

CREATE INDEX IF NOT EXISTS idx_partner_documents_fts
    ON cvc.partner_documents
    USING GIN(to_tsvector('english', COALESCE(raw_text, '')));

CREATE TABLE IF NOT EXISTS cvc.partner_notes (
    id          SERIAL PRIMARY KEY,
    partner_id  INTEGER NOT NULL REFERENCES cvc.partners(id) ON DELETE CASCADE,
    body        TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    created_by  TEXT DEFAULT 'admin'
);

CREATE INDEX IF NOT EXISTS idx_partner_notes_partner_id
    ON cvc.partner_notes(partner_id);
