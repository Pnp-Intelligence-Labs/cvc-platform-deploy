-- Migration 036: Partner service usage tracking
-- Tracks per-partner, per-year, per-service quantity included vs. used.
-- Canonical service list aligns to SLAM Service Audit spreadsheet.

CREATE TABLE IF NOT EXISTS cvc.partner_service_usage (
    id              SERIAL PRIMARY KEY,
    partner_id      INTEGER NOT NULL REFERENCES cvc.partners(id) ON DELETE CASCADE,
    year            INTEGER NOT NULL,
    service_name    TEXT NOT NULL,
    quantity_included INTEGER DEFAULT 0,
    quantity_used   INTEGER DEFAULT 0,
    notes           TEXT,
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (partner_id, year, service_name)
);

CREATE INDEX IF NOT EXISTS idx_partner_service_usage_partner_year
    ON cvc.partner_service_usage (partner_id, year);
