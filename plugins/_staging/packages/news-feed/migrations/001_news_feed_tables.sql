-- News Feed plugin migration 001
-- Tables are created by core migrations. This migration ensures they exist
-- for teams that deployed before the core migrations added them.

CREATE TABLE IF NOT EXISTS cvc.news_watch_companies (
    id           SERIAL PRIMARY KEY,
    company_name TEXT NOT NULL,
    category     TEXT,
    ticker       TEXT,
    active       BOOLEAN NOT NULL DEFAULT true,
    partner_id   INTEGER REFERENCES cvc.partners(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ DEFAULT now(),
    UNIQUE (company_name)
);

CREATE TABLE IF NOT EXISTS cvc.category_news (
    id             SERIAL PRIMARY KEY,
    link           TEXT NOT NULL,
    company_name   TEXT,
    title          TEXT,
    published_at   TIMESTAMPTZ,
    activity_type  TEXT,
    formatted_date TEXT,
    partner_id     INTEGER,
    hidden         BOOLEAN DEFAULT false,
    created_at     TIMESTAMPTZ DEFAULT now()
);

-- Idempotent column additions
ALTER TABLE cvc.news_watch_companies ADD COLUMN IF NOT EXISTS partner_id INTEGER REFERENCES cvc.partners(id) ON DELETE SET NULL;
ALTER TABLE cvc.category_news        ADD COLUMN IF NOT EXISTS partner_id INTEGER;
ALTER TABLE cvc.category_news        ADD COLUMN IF NOT EXISTS hidden     BOOLEAN DEFAULT false;
