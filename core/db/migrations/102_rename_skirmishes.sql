-- Migration 102: Rename cvc.skirmishes → cvc.requests
-- Run on Dell: psql -U producer -d cvc_db -f 102_rename_skirmishes.sql

BEGIN;

-- Rename the main table
ALTER TABLE cvc.skirmishes RENAME TO requests;

-- Rename related tables
ALTER TABLE cvc.skirmish_assignees RENAME TO request_assignees;
ALTER TABLE cvc.skirmish_updates   RENAME TO request_updates;

-- Rename foreign key columns to match new table names
ALTER TABLE cvc.request_assignees RENAME COLUMN skirmish_id TO request_id;
ALTER TABLE cvc.request_updates   RENAME COLUMN skirmish_id TO request_id;

-- Rename indexes and constraints dynamically
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'cvc'
          AND (indexname ILIKE '%skirmish%')
    LOOP
        EXECUTE format(
            'ALTER INDEX cvc.%I RENAME TO %I',
            r.indexname,
            regexp_replace(r.indexname, 'skirmish', 'request', 'gi')
        );
    END LOOP;
END;
$$;

-- Rename foreign key constraints dynamically
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT conname, conrelid::regclass AS tbl
        FROM pg_constraint
        WHERE connamespace = 'cvc'::regnamespace
          AND conname ILIKE '%skirmish%'
    LOOP
        EXECUTE format(
            'ALTER TABLE %s RENAME CONSTRAINT %I TO %I',
            r.tbl,
            r.conname,
            regexp_replace(r.conname, 'skirmish', 'request', 'gi')
        );
    END LOOP;
END;
$$;

COMMIT;
