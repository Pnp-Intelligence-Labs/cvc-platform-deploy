-- Migration 034: Partner Advisory Terminal schema
-- Adds partner DNA profile fields and structured advisory log table

-- Partner profile fields for Compatibility Index engine
ALTER TABLE cvc.partners
    ADD COLUMN IF NOT EXISTS current_protocols   text[],
    ADD COLUMN IF NOT EXISTS cloud_platform      text,
    ADD COLUMN IF NOT EXISTS hardware_vendors    text[],
    ADD COLUMN IF NOT EXISTS factory_regions     text[],
    ADD COLUMN IF NOT EXISTS scaling_speed       text CHECK (scaling_speed IN ('fast', 'medium', 'slow'));

-- Advisory log: structured CRM entries per partner (and optionally per company)
-- Replaces unstructured notes for advisory workflow
CREATE TABLE IF NOT EXISTS cvc.partner_advisory_logs (
    id           SERIAL PRIMARY KEY,
    partner_id   INTEGER NOT NULL REFERENCES cvc.partners(id) ON DELETE CASCADE,
    company_id   INTEGER REFERENCES cvc.companies(id) ON DELETE SET NULL,
    log_type     TEXT NOT NULL CHECK (log_type IN (
                     'meeting', 'recommendation', 'outcome',
                     'action_item', 'proximity_signal'
                 )),
    body         TEXT NOT NULL,
    meeting_date DATE,
    outcome      TEXT,
    next_steps   TEXT,
    source_url   TEXT,   -- endnote link (used by proximity_signal entries)
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    created_by   TEXT DEFAULT 'admin'
);

CREATE INDEX IF NOT EXISTS idx_pal_partner_id  ON cvc.partner_advisory_logs(partner_id);
CREATE INDEX IF NOT EXISTS idx_pal_company_id  ON cvc.partner_advisory_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_pal_created_at  ON cvc.partner_advisory_logs(created_at DESC);
