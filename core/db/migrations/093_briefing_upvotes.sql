-- Migration 093: briefing_upvotes — team engagement tracking on weekly intelligence briefing
-- One row per (week_start, insight_text, upvoted_by). UNIQUE prevents double-upvote.
-- insight_id links to briefing_insights for podcast/partner rows; NULL for text-only bullets.

CREATE TABLE IF NOT EXISTS cvc.briefing_upvotes (
    id           SERIAL PRIMARY KEY,
    week_start   DATE NOT NULL,
    insight_id   INTEGER REFERENCES cvc.briefing_insights(id) ON DELETE SET NULL,
    insight_text TEXT NOT NULL,
    section      TEXT NOT NULL DEFAULT 'Podcasts',
    source_title TEXT,
    source_url   TEXT,
    upvoted_by   TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (week_start, insight_text, upvoted_by)
);

CREATE INDEX IF NOT EXISTS idx_briefing_upvotes_week ON cvc.briefing_upvotes(week_start);
CREATE INDEX IF NOT EXISTS idx_briefing_upvotes_user ON cvc.briefing_upvotes(upvoted_by);
