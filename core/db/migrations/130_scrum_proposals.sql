-- Migration 130: Feature proposal intake queue for Scrum tab
--
-- Anyone on the platform can submit a feature proposal with 5 structured fields
-- that mirror how Nate briefs new features. GP reviews the list and converts
-- approved proposals into full Scrum items.

CREATE TABLE IF NOT EXISTS cvc.scrum_proposals (
    id                  serial PRIMARY KEY,
    title               text NOT NULL,
    what_to_build       text,                       -- the feature description
    what_it_does        text,                       -- expected behavior / outcome
    why_we_want_it      text,                       -- business reason / problem solved
    where_it_lives      text,                       -- which page or section
    what_it_connects_to text,                       -- integrations / data / systems needed
    submitted_by        text NOT NULL,
    status              text NOT NULL DEFAULT 'pending',  -- pending | converted | dismissed
    scrum_item_id       int REFERENCES cvc.scrum_items(id) ON DELETE SET NULL,
    created_at          timestamptz DEFAULT NOW(),
    updated_at          timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scrum_proposals_status ON cvc.scrum_proposals(status);
