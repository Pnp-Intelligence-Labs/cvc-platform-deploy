-- Migration 110: Partner Sector Profile
-- PSM-filled intake form capturing what each corporate partner wants from CVC
-- per sector. Lighter than associate sector eval — conversational, not weighted.

CREATE TABLE IF NOT EXISTS cvc.partner_sector_profile (
    id                  SERIAL PRIMARY KEY,
    partner_id          INTEGER NOT NULL REFERENCES cvc.partners(id) ON DELETE CASCADE,
    sector              TEXT NOT NULL,
    subsector           TEXT NOT NULL DEFAULT '',
    -- What kind of engagement are they seeking?
    engagement_type     TEXT[] NOT NULL DEFAULT '{}',
    -- What lens do they evaluate startups through?
    orientation         TEXT,
    -- Ordered list of what they value most (up to 3)
    top_priorities      TEXT[] NOT NULL DEFAULT '{}',
    -- Environment / operational constraints (Robotics / Manufacturing)
    environment_reqs    TEXT[] NOT NULL DEFAULT '{}',
    -- Are they willing to co-invest?
    investment_appetite TEXT,
    -- How many intros/sessions do they want per year from this sector?
    annual_target       INTEGER,
    -- What are they trying to solve? (PSM free-text from conversation)
    solving_notes       TEXT,
    -- Key concerns or blockers they've mentioned
    blocker_notes       TEXT,
    completed_by        TEXT,
    completed_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_by          TEXT,
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(partner_id, sector, subsector)
);

CREATE INDEX IF NOT EXISTS idx_psp_partner ON cvc.partner_sector_profile(partner_id);
CREATE INDEX IF NOT EXISTS idx_psp_sector  ON cvc.partner_sector_profile(sector);
