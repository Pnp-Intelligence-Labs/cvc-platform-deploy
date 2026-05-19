-- Migration 067: Partner intro tracking — timestamped startup<>partner introduction records
CREATE TABLE IF NOT EXISTS cvc.partner_intros (
    id              SERIAL PRIMARY KEY,
    company_id      INTEGER REFERENCES cvc.companies(id) ON DELETE SET NULL,
    partner_id      INTEGER REFERENCES cvc.partners(id) ON DELETE SET NULL,
    startup_name    TEXT NOT NULL,
    partner_name    TEXT NOT NULL,
    intro_date      DATE,
    delivered_date  DATE,
    receiver        TEXT,
    intro_type      TEXT,
    monday_doc_url  TEXT,
    source          TEXT DEFAULT 'sot_spreadsheet',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(startup_name, partner_name, intro_date)
);

CREATE INDEX IF NOT EXISTS partner_intros_company_id  ON cvc.partner_intros(company_id);
CREATE INDEX IF NOT EXISTS partner_intros_partner_id  ON cvc.partner_intros(partner_id);
CREATE INDEX IF NOT EXISTS partner_intros_intro_date  ON cvc.partner_intros(intro_date);
