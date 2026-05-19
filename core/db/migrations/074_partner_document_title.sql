-- Migration 074: Add user-editable title to partner_documents
-- Backfills from filename (strips extension, cleans underscores/dashes)

ALTER TABLE cvc.partner_documents
    ADD COLUMN IF NOT EXISTS title text;

UPDATE cvc.partner_documents
SET title = trim(
    regexp_replace(
        regexp_replace(filename, '\.[a-zA-Z0-9]{2,5}$', ''),  -- strip extension
        '[_]+', ' ', 'g'                                       -- underscores → spaces
    )
)
WHERE title IS NULL AND filename IS NOT NULL;
