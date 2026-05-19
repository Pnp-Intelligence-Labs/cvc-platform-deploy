-- Migration 069: Partner problem board cards
-- Each row = a challenge the partner has articulated.
-- confidence_score drives card opacity: low = vague ("we want AI"), high = KPI-backed.
CREATE TABLE IF NOT EXISTS cvc.partner_problems (
    id               SERIAL PRIMARY KEY,
    partner_id       INTEGER REFERENCES cvc.partners(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    description      TEXT,
    kpi              TEXT,           -- specific success metric, e.g. "reduce picking errors by 15%"
    confidence_score INTEGER DEFAULT 50 CHECK (confidence_score BETWEEN 0 AND 100),
    status           TEXT DEFAULT 'identified' CHECK (status IN ('identified','defined','active','solved')),
    source           TEXT,           -- e.g. "meeting 2026-03-15", "email", "call"
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS partner_problems_partner_id ON cvc.partner_problems(partner_id);
