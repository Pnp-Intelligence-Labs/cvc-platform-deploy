-- Migration 090: partner_intros match review columns
-- Adds suggested_company_id + match_confidence for human review of fuzzy matches.
-- company_id = confirmed link (exact match or human-approved)
-- suggested_company_id = possible link, needs human review
-- match_confidence = 0.0-1.0 fuzzy score

ALTER TABLE cvc.partner_intros
    ADD COLUMN IF NOT EXISTS suggested_company_id INT REFERENCES cvc.companies(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS match_confidence FLOAT,
    ADD COLUMN IF NOT EXISTS match_reviewed BOOLEAN NOT NULL DEFAULT FALSE;
