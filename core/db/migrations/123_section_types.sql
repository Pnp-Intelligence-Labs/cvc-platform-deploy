-- migration 123: section types + chart metadata for custom report workspace
-- SAFE: additive only — DEFAULT values preserve all existing data
-- These tables ONLY exist for the Custom Report feature (created in migration 122).
-- No other platform feature reads or writes these tables.

ALTER TABLE cvc.report_sections
  ADD COLUMN IF NOT EXISTS section_type TEXT NOT NULL DEFAULT 'prose';

-- Chart metadata on sources so assembled HTML can embed Chart.js charts
ALTER TABLE cvc.report_sources
  ADD COLUMN IF NOT EXISTS chart_type TEXT,
  ADD COLUMN IF NOT EXISTS x_key      TEXT,
  ADD COLUMN IF NOT EXISTS y_key      TEXT;
