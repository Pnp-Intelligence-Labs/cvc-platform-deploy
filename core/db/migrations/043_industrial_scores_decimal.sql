-- Migration 043: Allow decimal precision on industrial scores
-- industrial_readiness_score and sovereignty_score were INTEGER — promoting to NUMERIC(4,1)
-- so scores like 7.3, 8.5 can be entered instead of only whole numbers.

ALTER TABLE cvc.companies
    ALTER COLUMN industrial_readiness_score TYPE NUMERIC(4,1),
    ALTER COLUMN sovereignty_score TYPE NUMERIC(4,1);

COMMENT ON COLUMN cvc.companies.industrial_readiness_score IS
'Pilot-to-Production readiness score 0.0–10.0 (1 decimal place). Set via Industrial Matrix UI.';

COMMENT ON COLUMN cvc.companies.sovereignty_score IS
'Geopolitical sovereignty score 0.0–10.0 (1 decimal place). Set via Industrial Matrix UI.';
