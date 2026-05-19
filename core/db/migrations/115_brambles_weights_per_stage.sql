-- Migration 115: Fix brambles_section_weights unique constraint
-- Old constraint (pipeline_id, section) meant weights for different stage groups
-- overwrote each other. New key includes startup_type + stage_group so each
-- type+stage combo stores independently.

-- Drop old constraint and any existing data (saved without stage context — unusable)
DELETE FROM cvc.brambles_section_weights;

ALTER TABLE cvc.brambles_section_weights
  DROP CONSTRAINT brambles_section_weights_pipeline_id_section_key;

ALTER TABLE cvc.brambles_section_weights
  ADD CONSTRAINT brambles_section_weights_pipeline_type_stage_section_key
  UNIQUE (pipeline_id, startup_type, stage_group, section);
