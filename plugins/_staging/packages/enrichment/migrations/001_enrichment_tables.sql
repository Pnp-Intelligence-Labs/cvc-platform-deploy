-- Enrichment plugin migration 001
-- Ensures all tables required by the enrichment pipeline exist.
-- All tables are also created by core migrations; this is the safety net
-- for deployments that install the plugin before running all core migrations.

-- build_tasks — task queue for enrichment workers
CREATE TABLE IF NOT EXISTS cvc.build_tasks (
    id          SERIAL PRIMARY KEY,
    task_type   TEXT NOT NULL,
    payload     JSONB NOT NULL DEFAULT '{}',
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','cancelled')),
    priority    INT NOT NULL DEFAULT 5,
    retries     INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 3,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error_msg   TEXT,
    result      JSONB
);
CREATE INDEX IF NOT EXISTS idx_build_tasks_status   ON cvc.build_tasks (status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_build_tasks_type     ON cvc.build_tasks (task_type, status);

-- company_activity_log — field-level audit trail for companies
CREATE TABLE IF NOT EXISTS cvc.company_activity_log (
    id            BIGSERIAL PRIMARY KEY,
    company_id    INT NOT NULL REFERENCES cvc.companies(id) ON DELETE CASCADE,
    changed_by    TEXT NOT NULL DEFAULT 'system',
    changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    field_name    TEXT NOT NULL,
    old_value     TEXT,
    new_value     TEXT,
    change_source TEXT NOT NULL DEFAULT 'manual'
);
CREATE INDEX IF NOT EXISTS idx_company_activity_log_company ON cvc.company_activity_log (company_id, changed_at DESC);

-- intel_suggestions — LLM-sourced field update suggestions pending review
CREATE TABLE IF NOT EXISTS cvc.intel_suggestions (
    id               SERIAL PRIMARY KEY,
    company_id       INTEGER NOT NULL REFERENCES cvc.companies(id) ON DELETE CASCADE,
    intel_id         INTEGER,
    suggestion_type  TEXT NOT NULL CHECK (suggestion_type IN (
                         'new_funding_round', 'field_update', 'new_investor'
                     )),
    field_name       TEXT,
    current_value    TEXT,
    suggested_value  TEXT,
    suggested_data   JSONB,
    confidence       NUMERIC(4,3) NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
    reasoning        TEXT,
    status           TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'accepted', 'rejected')),
    reviewed_by      TEXT,
    reviewed_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_intel_suggestions_company ON cvc.intel_suggestions (company_id, status);
CREATE INDEX IF NOT EXISTS idx_intel_suggestions_pending ON cvc.intel_suggestions (status) WHERE status = 'pending';

-- enrichment_snapshots — daily field-coverage snapshots
CREATE TABLE IF NOT EXISTS cvc.enrichment_snapshots (
    id                   SERIAL PRIMARY KEY,
    snapshot_date        DATE NOT NULL UNIQUE,
    total_companies      INT NOT NULL DEFAULT 0,
    has_one_liner        INT NOT NULL DEFAULT 0,
    has_description      INT NOT NULL DEFAULT 0,
    has_website          INT NOT NULL DEFAULT 0,
    has_founded          INT NOT NULL DEFAULT 0,
    has_hq_city          INT NOT NULL DEFAULT 0,
    has_employee_count   INT NOT NULL DEFAULT 0,
    has_total_raised     INT NOT NULL DEFAULT 0,
    has_investors        INT NOT NULL DEFAULT 0,
    has_4d               INT NOT NULL DEFAULT 0,
    has_subsector        INT NOT NULL DEFAULT 0,
    has_score            INT NOT NULL DEFAULT 0,
    has_commercial_signals INT NOT NULL DEFAULT 0,
    has_funding_rounds   INT NOT NULL DEFAULT 0,
    has_industrial_score INT NOT NULL DEFAULT 0,
    has_protocol_support INT NOT NULL DEFAULT 0,
    has_verified_certs   INT NOT NULL DEFAULT 0,
    has_news_articles    INT NOT NULL DEFAULT 0,
    has_case_studies     INT NOT NULL DEFAULT 0,
    has_founders         INT NOT NULL DEFAULT 0,
    has_linkedin         INT NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent additions for enrichment-related columns on companies
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS enrichment_status   TEXT DEFAULT 'pending';
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS enrichment_source   TEXT;
ALTER TABLE cvc.companies ADD COLUMN IF NOT EXISTS last_enriched_at    TIMESTAMPTZ;
ALTER TABLE cvc.funding_rounds ADD COLUMN IF NOT EXISTS approximate    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cvc.funding_rounds ADD COLUMN IF NOT EXISTS notes          TEXT;
