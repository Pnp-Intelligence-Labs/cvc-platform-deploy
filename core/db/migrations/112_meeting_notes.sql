-- Migration 112: meeting_notes table
-- Stores timestamped notes from ventures/PSM/sales team meetings with startups.
-- personal_note is private (filtered at API layer); all other fields are team-visible.

CREATE TABLE IF NOT EXISTS cvc.meeting_notes (
    id                  SERIAL PRIMARY KEY,
    submitted_by        TEXT        NOT NULL,
    submitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    context_type        TEXT        NOT NULL DEFAULT 'ventures'
                            CHECK (context_type IN ('ventures', 'psm', 'sales')),
    company_id          INT REFERENCES cvc.companies(id) ON DELETE SET NULL,
    company_name        TEXT        NOT NULL DEFAULT '',
    company_url         TEXT,
    met_at              DATE        NOT NULL DEFAULT CURRENT_DATE,
    -- impression dimensions: 1-5 rating + optional prose note
    rating_founder      SMALLINT    CHECK (rating_founder    BETWEEN 1 AND 5),
    note_founder        TEXT,
    rating_market       SMALLINT    CHECK (rating_market     BETWEEN 1 AND 5),
    note_market         TEXT,
    rating_tech         SMALLINT    CHECK (rating_tech       BETWEEN 1 AND 5),
    note_tech           TEXT,
    rating_business     SMALLINT    CHECK (rating_business   BETWEEN 1 AND 5),
    note_business       TEXT,
    rating_deployment   SMALLINT    CHECK (rating_deployment BETWEEN 1 AND 5),
    note_deployment     TEXT,
    -- personal impression (never returned for other users)
    personal_note       TEXT,
    -- transcript: pasted text or path to uploaded file
    transcript_text     TEXT,
    transcript_path     TEXT
);

CREATE INDEX IF NOT EXISTS meeting_notes_company_id_idx  ON cvc.meeting_notes(company_id);
CREATE INDEX IF NOT EXISTS meeting_notes_submitted_by_idx ON cvc.meeting_notes(submitted_by);
CREATE INDEX IF NOT EXISTS meeting_notes_met_at_idx       ON cvc.meeting_notes(met_at DESC);
