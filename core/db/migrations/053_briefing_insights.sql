-- Migration 053: briefing_insights
-- Stores individual insights from each weekly briefing with timestamps.
-- Enables: expandable sources in UI, trend tracking over time, sector tagging.

CREATE TABLE IF NOT EXISTS cvc.briefing_insights (
    id           SERIAL PRIMARY KEY,
    week_start   DATE NOT NULL,
    source_type  TEXT NOT NULL CHECK (source_type IN ('podcast', 'news', 'article')),
    source_title TEXT,           -- episode title or article headline
    source_url   TEXT,
    show_name    TEXT,           -- podcast show name
    insight      TEXT NOT NULL,
    expert       TEXT,           -- podcast expert attribution
    confidence   TEXT,           -- HIGH / MEDIUM / LOW (podcast only)
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_briefing_insights_week ON cvc.briefing_insights (week_start DESC);
CREATE INDEX idx_briefing_insights_source_type ON cvc.briefing_insights (source_type);
