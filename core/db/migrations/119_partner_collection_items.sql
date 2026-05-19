-- Migration 119: partner_collection_items
-- Individual startup entries within a collection.
-- company_id is nullable — supports startups not yet in our DB.
-- intro_id is set when the PSM logs the startup as Introduced in the tracker.

CREATE TABLE IF NOT EXISTS cvc.partner_collection_items (
    id              SERIAL PRIMARY KEY,
    collection_id   INTEGER NOT NULL REFERENCES cvc.partner_collections(id) ON DELETE CASCADE,
    company_id      INTEGER REFERENCES cvc.companies(id) ON DELETE SET NULL, -- null if not in DB yet
    startup_name    TEXT NOT NULL,
    on_shortlist    BOOLEAN NOT NULL DEFAULT FALSE,  -- partner selected this one for a meeting
    intro_id        INTEGER REFERENCES cvc.partner_intros(id) ON DELETE SET NULL, -- linked when intro logged
    notes           TEXT,
    added_by        TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE  cvc.partner_collection_items               IS 'Startups within a collection. Shortlist flag set by PSM after partner responds.';
COMMENT ON COLUMN cvc.partner_collection_items.on_shortlist  IS 'True = partner requested a meeting with this startup.';
COMMENT ON COLUMN cvc.partner_collection_items.intro_id      IS 'Set when PSM logs this startup as Introduced in the startup tracker.';
