-- Migration 128: Partner service notes
-- Repurposes partner_notes for service terminal use only.
-- Drops unused visibility/assigned_psm columns (0 rows, never had a working POST endpoint).
-- Adds note_type and is_service_note flag.

ALTER TABLE cvc.partner_notes
  DROP COLUMN IF EXISTS visibility,
  DROP COLUMN IF EXISTS assigned_psm,
  ADD COLUMN IF NOT EXISTS note_type    text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS is_service_note boolean NOT NULL DEFAULT true;

-- Constraint: note_type must be one of the known types
ALTER TABLE cvc.partner_notes
  DROP CONSTRAINT IF EXISTS partner_notes_type_check;
ALTER TABLE cvc.partner_notes
  ADD CONSTRAINT partner_notes_type_check
  CHECK (note_type IN ('call', 'meeting', 'email', 'internal', 'general'));
