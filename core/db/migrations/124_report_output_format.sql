-- migration 124: output_format on trend_reports
-- SAFE: additive only — DEFAULT 'report' preserves all existing rows
-- Used by assemble_report() to choose citation style:
--   'report' = inline [N] superscripts + numbered endnotes + bibliography
--   'blog'   = hyperlinked [N] anchors + references list

ALTER TABLE cvc.trend_reports
  ADD COLUMN IF NOT EXISTS output_format TEXT NOT NULL DEFAULT 'report';
