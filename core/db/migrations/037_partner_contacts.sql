-- Migration 037: Partner contacts (one-to-many, with title)
-- Replaces single contact_name/contact_email columns on cvc.partners.

CREATE TABLE IF NOT EXISTS cvc.partner_contacts (
    id          SERIAL PRIMARY KEY,
    partner_id  INTEGER NOT NULL REFERENCES cvc.partners(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    title       TEXT,
    email       TEXT,
    phone       TEXT,
    is_primary  BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_contacts_partner_id
    ON cvc.partner_contacts (partner_id);
