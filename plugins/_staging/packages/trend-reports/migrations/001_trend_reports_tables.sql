-- Trend Reports plugin migration 001
-- Creates all tables required by the Report Workspace.
-- Safe to run after core migrations — all statements use IF NOT EXISTS.

-- Core report tables (core migration 122)
CREATE TABLE IF NOT EXISTS cvc.trend_reports (
    id              SERIAL PRIMARY KEY,
    title           TEXT NOT NULL,
    sector          TEXT,
    theme           TEXT,
    date_from       DATE,
    date_to         DATE,
    status          TEXT NOT NULL DEFAULT 'draft',
    created_by      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    report_brief    TEXT,
    published_html  TEXT
);

CREATE TABLE IF NOT EXISTS cvc.report_sections (
    id               SERIAL PRIMARY KEY,
    report_id        INT NOT NULL REFERENCES cvc.trend_reports(id) ON DELETE CASCADE,
    position         INT NOT NULL DEFAULT 0,
    title            TEXT NOT NULL,
    instructions     TEXT,
    data_sources     JSONB NOT NULL DEFAULT '[]',
    status           TEXT NOT NULL DEFAULT 'pending',
    content          TEXT,
    confidence_score FLOAT,
    generated_at     TIMESTAMPTZ,
    version_history  JSONB NOT NULL DEFAULT '[]',
    error_msg        TEXT
);

CREATE TABLE IF NOT EXISTS cvc.report_sources (
    id           SERIAL PRIMARY KEY,
    report_id    INT NOT NULL REFERENCES cvc.trend_reports(id) ON DELETE CASCADE,
    section_id   INT REFERENCES cvc.report_sections(id) ON DELETE SET NULL,
    source_type  TEXT NOT NULL,
    label        TEXT,
    filename     TEXT,
    file_path    TEXT,
    content_text TEXT,
    query_sql    TEXT,
    query_result JSONB,
    article_url  TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_sections_report_id ON cvc.report_sections(report_id);
CREATE INDEX IF NOT EXISTS idx_report_sources_report_id  ON cvc.report_sources(report_id);
CREATE INDEX IF NOT EXISTS idx_report_sources_section_id ON cvc.report_sources(section_id);

-- Annotations table (core migration 125)
CREATE TABLE IF NOT EXISTS cvc.report_annotations (
    id               SERIAL PRIMARY KEY,
    report_id        INT NOT NULL REFERENCES cvc.trend_reports(id) ON DELETE CASCADE,
    scope            TEXT NOT NULL DEFAULT 'inline',
    selected_text    TEXT,
    comment          TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'open',
    proposed_rewrite TEXT,
    created_by       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    addressed_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_report_annotations_report ON cvc.report_annotations(report_id, status);

-- Column extensions (core migrations 123–127)
ALTER TABLE cvc.report_sections   ADD COLUMN IF NOT EXISTS section_type TEXT NOT NULL DEFAULT 'prose';
ALTER TABLE cvc.report_sections   ADD COLUMN IF NOT EXISTS audience     TEXT DEFAULT NULL;
ALTER TABLE cvc.report_sections   ADD COLUMN IF NOT EXISTS tone         TEXT DEFAULT NULL;
ALTER TABLE cvc.report_sources    ADD COLUMN IF NOT EXISTS chart_type   TEXT;
ALTER TABLE cvc.report_sources    ADD COLUMN IF NOT EXISTS x_key        TEXT;
ALTER TABLE cvc.report_sources    ADD COLUMN IF NOT EXISTS y_key        TEXT;
ALTER TABLE cvc.trend_reports     ADD COLUMN IF NOT EXISTS output_format TEXT NOT NULL DEFAULT 'report';
ALTER TABLE cvc.trend_reports     ADD COLUMN IF NOT EXISTS citation_style TEXT NOT NULL DEFAULT 'superscript';
ALTER TABLE cvc.trend_reports     ADD COLUMN IF NOT EXISTS audience     TEXT DEFAULT 'practitioner';
ALTER TABLE cvc.trend_reports     ADD COLUMN IF NOT EXISTS tone         TEXT DEFAULT 'analytical';

-- briefing_insights (core migration 053) — trend-reports reads this for signals
CREATE TABLE IF NOT EXISTS cvc.briefing_insights (
    id           SERIAL PRIMARY KEY,
    briefing_id  INT,
    title        TEXT NOT NULL,
    summary      TEXT,
    category     TEXT,
    sector       TEXT,
    relevance    TEXT,
    source_url   TEXT,
    source_name  TEXT,
    published_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
