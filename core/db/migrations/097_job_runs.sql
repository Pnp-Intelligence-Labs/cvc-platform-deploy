-- 097: job run history for nightly worker monitoring
CREATE TABLE cvc.job_runs (
    id           SERIAL PRIMARY KEY,
    job_name     TEXT        NOT NULL,
    machine      TEXT        NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at  TIMESTAMPTZ,
    status       TEXT        NOT NULL DEFAULT 'running',  -- running | ok | error
    summary      JSONB       NOT NULL DEFAULT '{}',
    error_text   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON cvc.job_runs (job_name, started_at DESC);
CREATE INDEX ON cvc.job_runs (started_at DESC);
