-- Migration 116: add is_legacy flag to partners
-- Legacy partners are former corporate members; shown separately on the partner hub

ALTER TABLE cvc.partners ADD COLUMN IF NOT EXISTS is_legacy boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN cvc.partners.is_legacy IS 'True = former partner, shown in Legacy Partners section on hub';
