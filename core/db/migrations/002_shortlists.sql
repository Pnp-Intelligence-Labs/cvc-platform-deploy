-- Migration: 002_shortlists.sql
-- Creates shortlist tables for startup sourcing feature

-- ── Shortlists table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cvc.shortlists (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Shortlist companies junction table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cvc.shortlist_companies (
    shortlist_id    INTEGER REFERENCES cvc.shortlists(id) ON DELETE CASCADE,
    company_id      INTEGER REFERENCES cvc.companies(id) ON DELETE CASCADE,
    added_at        TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (shortlist_id, company_id)
);

-- ── Indexes for performance ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_shortlists_created 
    ON cvc.shortlists(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shortlist_companies_shortlist 
    ON cvc.shortlist_companies(shortlist_id);

CREATE INDEX IF NOT EXISTS idx_shortlist_companies_company 
    ON cvc.shortlist_companies(company_id);
