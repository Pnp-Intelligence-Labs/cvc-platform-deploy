-- Migration 063: Verification evidence — screenshot collateral for approved/rejected source reviews

CREATE TABLE IF NOT EXISTS cvc.verification_evidence (
    id                  SERIAL PRIMARY KEY,
    suggestion_id       INTEGER REFERENCES cvc.intel_suggestions(id) ON DELETE SET NULL,
    company_id          INTEGER REFERENCES cvc.companies(id) ON DELETE SET NULL,
    url                 TEXT NOT NULL,
    decision            TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'edited')),
    reviewed_by         TEXT NOT NULL DEFAULT 'admin',
    reviewed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    screenshot          BYTEA,
    screenshot_taken_at TIMESTAMPTZ,
    screenshot_error    TEXT,
    edit_notes          TEXT
);

CREATE INDEX idx_verification_evidence_suggestion ON cvc.verification_evidence(suggestion_id);
CREATE INDEX idx_verification_evidence_company    ON cvc.verification_evidence(company_id);
CREATE INDEX idx_verification_evidence_reviewed   ON cvc.verification_evidence(reviewed_at DESC);
