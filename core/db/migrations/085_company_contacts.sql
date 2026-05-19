-- Migration 085: Company contacts table
-- Stores key contacts (CEO, founders, etc.) per company

CREATE TABLE IF NOT EXISTS cvc.company_contacts (
    id          SERIAL PRIMARY KEY,
    company_id  INTEGER NOT NULL REFERENCES cvc.companies(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    title       TEXT,
    email       TEXT,
    phone       TEXT,
    is_primary  BOOLEAN NOT NULL DEFAULT FALSE,
    added_by    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_contacts_company_id ON cvc.company_contacts(company_id);
