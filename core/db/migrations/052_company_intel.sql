-- Migration 052: company_intel table
-- Stores analyst-uploaded intelligence (PDFs, URLs, text) for individual companies.
-- Steps 3-5 (LLM processing, score signals, score suggestions) are future buildout.

CREATE TABLE IF NOT EXISTS cvc.company_intel (
    id              SERIAL PRIMARY KEY,
    company_id      INTEGER NOT NULL REFERENCES cvc.companies(id) ON DELETE CASCADE,
    intel_type      TEXT NOT NULL CHECK (intel_type IN ('pdf', 'url', 'text')),
    label           TEXT,                        -- analyst-given name ("Series A Deck", "TechCrunch article")
    source_url      TEXT,                        -- populated for url type
    file_path       TEXT,                        -- populated for pdf type, server-side path
    file_name       TEXT,                        -- original filename
    raw_text        TEXT,                        -- extracted text content
    summary         TEXT,                        -- reserved: LLM summary (future)
    signals         JSONB,                       -- reserved: extracted signals (future)
    score_impact    JSONB,                       -- reserved: suggested score changes (future)
    uploaded_by     TEXT NOT NULL,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_company_intel_company_id ON cvc.company_intel (company_id);
CREATE INDEX IF NOT EXISTS idx_company_intel_uploaded_at ON cvc.company_intel (uploaded_at DESC);
