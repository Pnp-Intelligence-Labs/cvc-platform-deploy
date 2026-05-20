-- Migration 132: Add linked_target_id to sales_targets
-- Column referenced in sales routes but missing from initial migration.

ALTER TABLE cvc.sales_targets
    ADD COLUMN IF NOT EXISTS linked_target_id INT REFERENCES cvc.sales_targets(id) ON DELETE SET NULL;
