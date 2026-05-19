-- Migration 094: briefing_comments — per-insight team discussion threads
-- One row per comment. No uniqueness constraint — multiple comments per person allowed.

CREATE TABLE IF NOT EXISTS cvc.briefing_comments (
    id           SERIAL PRIMARY KEY,
    week_start   DATE NOT NULL,
    insight_id   INTEGER REFERENCES cvc.briefing_insights(id) ON DELETE SET NULL,
    insight_text TEXT NOT NULL,
    section      TEXT NOT NULL DEFAULT 'Podcasts',
    comment      TEXT NOT NULL,
    commented_by TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_briefing_comments_week ON cvc.briefing_comments(week_start);
CREATE INDEX IF NOT EXISTS idx_briefing_comments_user ON cvc.briefing_comments(commented_by);
