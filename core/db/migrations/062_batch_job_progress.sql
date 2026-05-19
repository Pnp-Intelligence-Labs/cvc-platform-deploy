-- Migration 062: Add live progress tracking to batch_jobs
ALTER TABLE cvc.batch_jobs
  ADD COLUMN IF NOT EXISTS progress_current INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_total   INT NOT NULL DEFAULT 0;
