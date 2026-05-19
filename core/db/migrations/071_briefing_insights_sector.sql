-- Migration 071: add sector to briefing_insights
-- Allows weekly briefing to show signals grouped by CVC sector (Robotics, Supply Chain, etc.)

ALTER TABLE cvc.briefing_insights
    ADD COLUMN IF NOT EXISTS sector text;

CREATE INDEX IF NOT EXISTS idx_briefing_insights_sector
    ON cvc.briefing_insights (sector, week_start DESC);
