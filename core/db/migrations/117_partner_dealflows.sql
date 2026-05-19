-- Migration 117: partner_dealflows
-- One row per dealflow engagement. Always starts from a partner request.
-- display_id is auto-generated (DF-YYYY-NNN) at insert time by the API.

CREATE TABLE IF NOT EXISTS cvc.partner_dealflows (
    id          SERIAL PRIMARY KEY,
    partner_id  INTEGER NOT NULL REFERENCES cvc.partners(id) ON DELETE CASCADE,
    request_id  INTEGER REFERENCES cvc.partner_requests(id) ON DELETE SET NULL,
    display_id  TEXT,                        -- e.g. DF-2026-001
    tech_focus  TEXT,
    status      TEXT NOT NULL DEFAULT 'open',-- open / in_review / shortlisted / meetings / complete
    notes       TEXT,
    created_by  TEXT,                        -- username of PSM who created it
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE  cvc.partner_dealflows              IS 'Dealflow engagements per partner — always tied to a request.';
COMMENT ON COLUMN cvc.partner_dealflows.display_id   IS 'Human-readable ID: DF-YYYY-NNN, generated at insert.';
COMMENT ON COLUMN cvc.partner_dealflows.status       IS 'open → in_review → shortlisted → meetings → complete';
