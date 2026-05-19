-- Migration 109: sector eval subsectors + privacy enforcement
-- Adds subsector column to weights ('' = base sector eval, non-empty = subsector-specific).
-- Adds subsector registry table.
-- Privacy: team comparison is now GP-only at the API layer.

-- 1. Add subsector column (empty string = base, no subsector)
ALTER TABLE cvc.sector_eval_weights
  ADD COLUMN IF NOT EXISTS subsector TEXT NOT NULL DEFAULT '';

-- 2. Replace unique constraint to include subsector
ALTER TABLE cvc.sector_eval_weights
  DROP CONSTRAINT IF EXISTS sector_eval_weights_evaluator_sector_stage_field_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sector_eval_weights_unique_combo'
  ) THEN
    ALTER TABLE cvc.sector_eval_weights
      ADD CONSTRAINT sector_eval_weights_unique_combo
      UNIQUE (evaluator, sector, subsector, stage, field_id);
  END IF;
END
$$;

-- 3. Index for fast subsector lookups
CREATE INDEX IF NOT EXISTS idx_sew_sector_subsector
  ON cvc.sector_eval_weights (sector, subsector);

-- 4. Subsector registry: any user can create subsectors for a sector
CREATE TABLE IF NOT EXISTS cvc.sector_eval_subsectors (
  id         SERIAL PRIMARY KEY,
  sector     TEXT NOT NULL,
  subsector  TEXT NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sector, subsector)
);
