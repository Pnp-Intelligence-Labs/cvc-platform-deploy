-- Migration 113: add structured meeting-note fields to cvc.sales_notes
-- Populated when note_type = 'meeting' via the Quick Note panel.
-- personal_note is private (filtered at API layer — author only).

ALTER TABLE cvc.sales_notes
    ADD COLUMN IF NOT EXISTS meeting_date         DATE,
    ADD COLUMN IF NOT EXISTS tech_interest        TEXT,
    ADD COLUMN IF NOT EXISTS tech_challenge       TEXT,
    ADD COLUMN IF NOT EXISTS rating_buying_intent SMALLINT CHECK (rating_buying_intent BETWEEN 1 AND 5),
    ADD COLUMN IF NOT EXISTS rating_dm_access     SMALLINT CHECK (rating_dm_access     BETWEEN 1 AND 5),
    ADD COLUMN IF NOT EXISTS rating_budget_fit    SMALLINT CHECK (rating_budget_fit    BETWEEN 1 AND 5),
    ADD COLUMN IF NOT EXISTS rating_strategic_fit SMALLINT CHECK (rating_strategic_fit BETWEEN 1 AND 5),
    ADD COLUMN IF NOT EXISTS rating_timeline      SMALLINT CHECK (rating_timeline      BETWEEN 1 AND 5),
    ADD COLUMN IF NOT EXISTS personal_note        TEXT,
    ADD COLUMN IF NOT EXISTS transcript_text      TEXT;
