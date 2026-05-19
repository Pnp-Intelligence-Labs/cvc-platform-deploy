-- Migration: 004_build_tasks.sql
-- Creates autonomous build task queue for BigBossHog <-> Big Claw coordination

CREATE TABLE IF NOT EXISTS cvc.build_tasks (
    task_id           SERIAL PRIMARY KEY,
    spec              TEXT NOT NULL,
    priority          TEXT NOT NULL DEFAULT 'medium',   -- low / medium / high
    risk_level        TEXT NOT NULL,                    -- low / medium / high
    requires_approval BOOLEAN NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pending',  -- pending / approved / building / complete / failed / deployed
    created_by        TEXT NOT NULL DEFAULT 'bigbosshog',
    assigned_to       TEXT NOT NULL DEFAULT 'bigclaw',
    commit_hash       TEXT,
    nate_approved_at  TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at        TIMESTAMPTZ,
    completed_at      TIMESTAMPTZ,
    deployed_at       TIMESTAMPTZ,
    status_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes             TEXT
);

CREATE INDEX IF NOT EXISTS idx_build_tasks_status
    ON cvc.build_tasks(status);

CREATE INDEX IF NOT EXISTS idx_build_tasks_created
    ON cvc.build_tasks(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_build_tasks_status_created
    ON cvc.build_tasks(status, created_at ASC);
