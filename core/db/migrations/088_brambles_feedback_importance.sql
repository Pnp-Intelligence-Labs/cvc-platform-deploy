-- Migration 088: Add importance score to brambles_feedback
-- Analyst rates 1-5 (Not Important → Critical) per claim, independent of verdict.
-- Enables future training signal: which claim types matter for a given stage/sector.

ALTER TABLE cvc.brambles_feedback
    ADD COLUMN IF NOT EXISTS importance smallint CHECK (importance BETWEEN 1 AND 5);
