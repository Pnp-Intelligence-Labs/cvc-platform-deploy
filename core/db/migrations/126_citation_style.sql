-- migration 126: citation_style on trend_reports
-- SAFE: additive only — DEFAULT 'superscript' preserves all existing rows
ALTER TABLE cvc.trend_reports
  ADD COLUMN IF NOT EXISTS citation_style TEXT NOT NULL DEFAULT 'superscript';
