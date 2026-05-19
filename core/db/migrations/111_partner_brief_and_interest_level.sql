-- Migration 111: Partner brief + interest level on sector profile
-- partner_brief: overall narrative about what this partner wants from CVC
-- interest_level: simple 1-5 signal per sector (no longer forcing rigid pill fields)

ALTER TABLE cvc.partners
    ADD COLUMN IF NOT EXISTS partner_brief TEXT;

ALTER TABLE cvc.partner_sector_profile
    ADD COLUMN IF NOT EXISTS interest_level SMALLINT CHECK (interest_level BETWEEN 1 AND 5);
