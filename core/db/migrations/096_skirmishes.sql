-- Migration 096: skirmishes
-- Team project tracker spawned from partner service requests.
-- Each service order creates one skirmish + one venture_assignment.

CREATE TABLE IF NOT EXISTS cvc.skirmishes (
    id                     SERIAL PRIMARY KEY,
    title                  TEXT        NOT NULL,
    service_type           TEXT        NOT NULL,   -- dealflow | intro | trend_report | innovation_day | other
    partner_id             INTEGER     REFERENCES cvc.partners(id) ON DELETE SET NULL,
    partner_name           TEXT,                   -- denormalized for display speed
    status                 TEXT        NOT NULL DEFAULT 'open',   -- open | active | completed | cancelled
    priority               TEXT        NOT NULL DEFAULT 'medium', -- high | medium | low
    service_fields         JSONB       NOT NULL DEFAULT '{}',     -- form data from service request modal
    venture_assignment_id  INTEGER,                               -- FK to cvc.venture_assignments (created simultaneously)
    created_by             TEXT        NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cvc.skirmish_assignees (
    skirmish_id  INTEGER NOT NULL REFERENCES cvc.skirmishes(id) ON DELETE CASCADE,
    username     TEXT    NOT NULL,
    assigned_by  TEXT    NOT NULL,
    assigned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (skirmish_id, username)
);

CREATE TABLE IF NOT EXISTS cvc.skirmish_updates (
    id           SERIAL PRIMARY KEY,
    skirmish_id  INTEGER NOT NULL REFERENCES cvc.skirmishes(id) ON DELETE CASCADE,
    author       TEXT    NOT NULL,
    body         TEXT    NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skirmishes_partner    ON cvc.skirmishes(partner_id);
CREATE INDEX IF NOT EXISTS idx_skirmishes_status     ON cvc.skirmishes(status);
CREATE INDEX IF NOT EXISTS idx_skirmish_updates_sid  ON cvc.skirmish_updates(skirmish_id);
