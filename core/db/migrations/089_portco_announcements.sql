-- Migration 089: portco_announcements — manual portfolio company news/intel entries
-- Stores private and public announcements for portfolio companies.
-- Separate from companies.news_articles (scraped) and commercial_deployments.

CREATE TABLE IF NOT EXISTS cvc.portco_announcements (
    id                  SERIAL PRIMARY KEY,
    company_id          INTEGER NOT NULL REFERENCES cvc.companies(id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    body                TEXT,
    announcement_type   TEXT NOT NULL DEFAULT 'general',
    -- Values: funding | partnership | product | press | internal | general
    is_public           BOOLEAN NOT NULL DEFAULT FALSE,
    -- FALSE = CVC-only intel (not yet public); TRUE = already public / press-confirmed
    source_url          TEXT,
    announced_date      DATE,
    added_by            TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portco_announcements_company_id ON cvc.portco_announcements(company_id);
CREATE INDEX IF NOT EXISTS idx_portco_announcements_announced_date ON cvc.portco_announcements(announced_date DESC);
