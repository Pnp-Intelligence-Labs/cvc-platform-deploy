-- Migration 127: audience and tone settings for reports and sections
-- Report-level defaults; section-level fields are nullable overrides.

ALTER TABLE cvc.trend_reports
  ADD COLUMN IF NOT EXISTS audience text DEFAULT 'practitioner',
  ADD COLUMN IF NOT EXISTS tone     text DEFAULT 'analytical';

ALTER TABLE cvc.report_sections
  ADD COLUMN IF NOT EXISTS audience text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tone     text DEFAULT NULL;

COMMENT ON COLUMN cvc.trend_reports.audience IS 'Target audience: executive | practitioner | investor | analyst | general';
COMMENT ON COLUMN cvc.trend_reports.tone     IS 'Writing tone: analytical | authoritative | narrative | concise | conversational';
COMMENT ON COLUMN cvc.report_sections.audience IS 'Section-level audience override (null = inherit from report)';
COMMENT ON COLUMN cvc.report_sections.tone     IS 'Section-level tone override (null = inherit from report)';
