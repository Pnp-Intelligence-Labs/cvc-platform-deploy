-- Migration 008: Weekly system metrics snapshot table
-- Populated by workers/audit/weekly_audit.py every Sunday evening

CREATE TABLE IF NOT EXISTS cvc.weekly_metrics (
    id                   SERIAL PRIMARY KEY,
    week_start           DATE NOT NULL UNIQUE,
    companies_total      INTEGER,
    companies_enriched   INTEGER,
    companies_scored     INTEGER,
    companies_null_sector INTEGER,
    content_items_total  INTEGER,
    funding_rounds_total INTEGER,
    tasks_deployed       INTEGER,
    tasks_failed         INTEGER,
    tasks_pending        INTEGER,
    audit_tasks_created  INTEGER,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE cvc.weekly_metrics IS 'Weekly system health snapshot written by weekly_audit.py every Sunday.';
