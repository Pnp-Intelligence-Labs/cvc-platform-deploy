-- Migration 095: venture_assignments
-- Tracks work assignments for the ventures team.
-- Initially manual-only; partner service requests will populate source='partner_request' in future.

CREATE TABLE IF NOT EXISTS cvc.venture_assignments (
    id           SERIAL PRIMARY KEY,
    title        TEXT        NOT NULL,
    notes        TEXT,
    source       TEXT        NOT NULL DEFAULT 'manual',   -- 'manual' | 'partner_request'
    partner_id   INTEGER     REFERENCES cvc.partners(id) ON DELETE SET NULL,
    company_id   INTEGER     REFERENCES cvc.companies(id) ON DELETE SET NULL,
    assigned_to  TEXT,                                     -- username; NULL = unassigned
    status       TEXT        NOT NULL DEFAULT 'open',      -- open | in_progress | completed | cancelled
    priority     TEXT        NOT NULL DEFAULT 'medium',    -- high | medium | low
    created_by   TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_venture_assignments_status   ON cvc.venture_assignments(status);
CREATE INDEX IF NOT EXISTS idx_venture_assignments_assigned ON cvc.venture_assignments(assigned_to);
