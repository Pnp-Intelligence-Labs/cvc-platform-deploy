-- Migration 099: News fetcher tables (port of Google Apps Script)

-- Companies to watch + their category assignment
CREATE TABLE IF NOT EXISTS cvc.news_watch_companies (
    id          SERIAL PRIMARY KEY,
    company_name TEXT NOT NULL,
    category    TEXT NOT NULL CHECK (category IN (
        'Sustainability', 'Agnostic', 'Health', 'Food & Beverage'
    )),
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_name, category)
);

-- News articles fetched per company per category
CREATE TABLE IF NOT EXISTS cvc.category_news (
    id              SERIAL PRIMARY KEY,
    link            TEXT NOT NULL,
    company_name    TEXT NOT NULL,
    category        TEXT NOT NULL,
    title           TEXT NOT NULL,
    published_at    TIMESTAMPTZ NOT NULL,
    formatted_date  TEXT,          -- human-readable date string (matches Apps Script format)
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (title, company_name)   -- deduplicate by headline + company
);

CREATE INDEX IF NOT EXISTS idx_category_news_category ON cvc.category_news (category);
CREATE INDEX IF NOT EXISTS idx_category_news_company ON cvc.category_news (company_name);
CREATE INDEX IF NOT EXISTS idx_category_news_published ON cvc.category_news (published_at DESC);

-- Register in cron_jobs for scheduler gate
INSERT INTO cvc.cron_jobs (name, schedule, active, description)
VALUES ('News Fetcher', '0 */6 * * *', true, 'Google News RSS fetcher for partner categories')
ON CONFLICT DO NOTHING;
