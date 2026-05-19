-- Migration 122: Trend Report Workspace
-- Tables: cvc.trend_reports, cvc.report_sections, cvc.report_sources

CREATE TABLE IF NOT EXISTS cvc.trend_reports (
    id              SERIAL PRIMARY KEY,
    title           TEXT NOT NULL,
    sector          TEXT,
    theme           TEXT,                    -- one-line theme/angle description
    date_from       DATE,
    date_to         DATE,
    status          TEXT NOT NULL DEFAULT 'draft',  -- draft | generating | ready | published
    created_by      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    report_brief    TEXT,                    -- LLM-generated summary of report intent, injected into every section
    published_html  TEXT                     -- final assembled HTML for download/display
);

CREATE TABLE IF NOT EXISTS cvc.report_sections (
    id              SERIAL PRIMARY KEY,
    report_id       INT NOT NULL REFERENCES cvc.trend_reports(id) ON DELETE CASCADE,
    position        INT NOT NULL DEFAULT 0,
    title           TEXT NOT NULL,
    instructions    TEXT,                    -- analyst guidance for this section
    data_sources    JSONB NOT NULL DEFAULT '[]',  -- [{source_id, type, label}]
    status          TEXT NOT NULL DEFAULT 'pending',  -- pending | generating | done | error
    content         TEXT,                    -- generated HTML/prose content
    confidence_score FLOAT,                  -- 0.0-1.0 ratio of sourced vs inferred content
    generated_at    TIMESTAMPTZ,
    version_history JSONB NOT NULL DEFAULT '[]',  -- [{content, generated_at, confidence_score}]
    error_msg       TEXT
);

CREATE TABLE IF NOT EXISTS cvc.report_sources (
    id              SERIAL PRIMARY KEY,
    report_id       INT NOT NULL REFERENCES cvc.trend_reports(id) ON DELETE CASCADE,
    section_id      INT REFERENCES cvc.report_sections(id) ON DELETE SET NULL,  -- NULL = available to all sections
    source_type     TEXT NOT NULL,  -- pdf | article | db_query | paste
    label           TEXT,           -- display name shown in the UI
    filename        TEXT,           -- for pdf uploads
    file_path       TEXT,           -- server-side stored path
    content_text    TEXT,           -- extracted/pasted text content
    query_sql       TEXT,           -- for db_query type
    query_result    JSONB,          -- cached query output
    article_url     TEXT,           -- for article type
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_sections_report_id ON cvc.report_sections(report_id);
CREATE INDEX IF NOT EXISTS idx_report_sources_report_id  ON cvc.report_sources(report_id);
CREATE INDEX IF NOT EXISTS idx_report_sources_section_id ON cvc.report_sources(section_id);
