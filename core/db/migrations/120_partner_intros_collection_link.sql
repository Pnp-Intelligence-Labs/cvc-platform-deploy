-- Migration 120: link partner_intros back to the collection item that sourced them
-- Nullable — existing 2,790 intros stay unlinked; backfill manually as needed.

ALTER TABLE cvc.partner_intros
    ADD COLUMN IF NOT EXISTS collection_item_id INTEGER
        REFERENCES cvc.partner_collection_items(id) ON DELETE SET NULL;

COMMENT ON COLUMN cvc.partner_intros.collection_item_id IS
    'Links this intro back to the collection item it was sourced from. NULL for ad-hoc or pre-collection intros.';
