-- Migration 073: Add membership_level to partners
-- Levels: Ecosystem, Ecosystem+, Anchor, Founding Anchor

ALTER TABLE cvc.partners
    ADD COLUMN IF NOT EXISTS membership_level text
        CHECK (membership_level IS NULL OR membership_level IN (
            'Ecosystem', 'Ecosystem+', 'Anchor', 'Founding Anchor'
        ));
