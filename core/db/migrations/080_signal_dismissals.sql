-- Migration 080: signal_dismissals — per-partner content curation
--
-- When a signal content item is flagged as irrelevant for a specific partner
-- (false positive from entity matching), store the dismissal so it is
-- permanently excluded from that partner's signal feed.
--
-- Dismissed = bad entity extraction, not a reflection on the content itself.
-- Same content item could still surface for a different partner.

CREATE TABLE IF NOT EXISTS cvc.signal_dismissals (
    partner_id      INTEGER NOT NULL REFERENCES cvc.partners(id) ON DELETE CASCADE,
    content_item_id UUID    NOT NULL,
    dismissed_by    TEXT,
    dismissed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (partner_id, content_item_id)
);

CREATE INDEX IF NOT EXISTS idx_signal_dismissals_partner
    ON cvc.signal_dismissals(partner_id);
