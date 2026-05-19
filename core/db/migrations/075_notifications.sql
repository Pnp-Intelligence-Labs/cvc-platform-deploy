-- Migration 075: Notification table for bell UI
-- Stores explicit notifications written by workers (enrichment batch summaries, etc.)
-- The API aggregates these with derived notifications from build_tasks and agent_memory.

CREATE TABLE IF NOT EXISTS cvc.notifications (
    id              SERIAL PRIMARY KEY,
    type            VARCHAR(50)  NOT NULL,  -- 'enrichment', 'dd_complete', 'batch_enrichment', 'agent_update'
    title           TEXT         NOT NULL,
    body            TEXT,
    source          VARCHAR(100),           -- 'enrich_worker', 'bigclaw', 'bigbosshog', etc.
    link            TEXT,                   -- deep link e.g. /company/45
    reference_id    INTEGER,                -- company_id, task_id, or batch_job_id
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON cvc.notifications (created_at DESC);
