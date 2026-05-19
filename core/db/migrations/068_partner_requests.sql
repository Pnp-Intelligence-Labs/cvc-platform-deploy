-- Migration 068: Partner long-list request history
-- Each row = a partner asked for startups in a tech focus area at a point in time.
-- Enables interest-over-time tracking, conversion funnel analytics, AM attribution.
CREATE TABLE IF NOT EXISTS cvc.partner_requests (
    id               SERIAL PRIMARY KEY,
    partner_id       INTEGER REFERENCES cvc.partners(id) ON DELETE SET NULL,
    partner_name     TEXT NOT NULL,
    requested_date   DATE,
    due_date         DATE,
    year             SMALLINT,
    tech_focus       TEXT,
    notes            TEXT,
    requester        TEXT,          -- AM who took the request
    ventures_person  TEXT,          -- Ventures person who fulfilled
    office           TEXT,
    playbook_url     TEXT,
    completed_date   DATE,
    is_complete      BOOLEAN DEFAULT FALSE,
    led_to_dealflow  BOOLEAN,
    dealflow_date    DATE,
    had_startup_intros BOOLEAN,
    source           TEXT DEFAULT 'sc_longlist',
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(partner_name, tech_focus, requested_date)
);

CREATE INDEX IF NOT EXISTS partner_requests_partner_id   ON cvc.partner_requests(partner_id);
CREATE INDEX IF NOT EXISTS partner_requests_year         ON cvc.partner_requests(year);
CREATE INDEX IF NOT EXISTS partner_requests_tech_focus   ON cvc.partner_requests(tech_focus);
CREATE INDEX IF NOT EXISTS partner_requests_requested_dt ON cvc.partner_requests(requested_date);
