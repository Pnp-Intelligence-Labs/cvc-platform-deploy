-- Migration 081: DD analyst feedback table
-- Stores per-finding corrections from analyst-reviewed scorecards.
-- Used to improve DD agent flagging accuracy over time.

CREATE TABLE IF NOT EXISTS cvc.dd_feedback (
    id               SERIAL PRIMARY KEY,
    company_id       INTEGER REFERENCES cvc.companies(id) ON DELETE CASCADE,
    company_name     TEXT NOT NULL,
    finding_id       TEXT,                  -- e.g. "financials_001"
    agent            TEXT,                  -- financials | comp | qualitative | product | news
    topic            TEXT,
    our_finding      TEXT,
    claimed          TEXT,
    verdict          TEXT,
    was_flagged      BOOLEAN,
    accuracy_rating  TEXT,                  -- correct | partially correct | wrong | not relevant
    flag_rating      TEXT,                  -- flag justified | over-flagged | should have been flagged | n/a
    analyst_notes    TEXT,
    reviewed_by      TEXT,
    reviewed_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dd_feedback_company_idx ON cvc.dd_feedback(company_id);
CREATE INDEX IF NOT EXISTS dd_feedback_agent_idx   ON cvc.dd_feedback(agent);
CREATE INDEX IF NOT EXISTS dd_feedback_flag_idx    ON cvc.dd_feedback(flag_rating);
