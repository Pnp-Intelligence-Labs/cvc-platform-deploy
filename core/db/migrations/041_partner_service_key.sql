-- Migration 041: Add service_key column to partner_service_usage
-- BigClaw's rewrite of partners.py referenced this column but never created it,
-- causing a 500 on GET /partners/{id}/services and breaking the service usage section.

ALTER TABLE cvc.partner_service_usage
    ADD COLUMN IF NOT EXISTS service_key TEXT;

COMMENT ON COLUMN cvc.partner_service_usage.service_key IS
'Optional machine-readable key for the service (e.g. "dealflow_sessions"). Not required.';
