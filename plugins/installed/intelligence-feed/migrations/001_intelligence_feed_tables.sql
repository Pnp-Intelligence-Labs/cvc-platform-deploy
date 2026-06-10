-- Intelligence Feed plugin migration 001
-- Tables are created by core migrations. This migration ensures they exist
-- for teams that deployed before the core migrations added them.

CREATE TABLE IF NOT EXISTS briefing_sources (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    url         TEXT,
    source_type TEXT NOT NULL DEFAULT 'rss',
    category    TEXT,
    active      BOOLEAN NOT NULL DEFAULT true,
    notes       TEXT,
    added_by    TEXT,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS llm_usage_log (
    id                SERIAL PRIMARY KEY,
    activity          TEXT,
    model             TEXT,
    prompt_tokens     INTEGER,
    completion_tokens INTEGER,
    cost              NUMERIC,
    called_at         TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cron_jobs (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    schedule    TEXT,
    description TEXT,
    command     TEXT,
    machine     TEXT,
    category    TEXT,
    active      BOOLEAN NOT NULL DEFAULT true,
    log_path    TEXT,
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Idempotent column additions
ALTER TABLE briefing_sources ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
