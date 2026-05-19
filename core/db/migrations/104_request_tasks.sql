-- Migration 104: request_tasks — line items for project management on requests

CREATE TABLE IF NOT EXISTS cvc.request_tasks (
    id          SERIAL PRIMARY KEY,
    request_id  INT NOT NULL REFERENCES cvc.requests(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    assigned_to TEXT,
    done        BOOLEAN NOT NULL DEFAULT FALSE,
    position    INT NOT NULL DEFAULT 0,
    created_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_request_tasks_request_position
    ON cvc.request_tasks(request_id, position);
