-- 098_local_extras.sql — production-only columns the API queries against
--
-- These columns exist on production tables (added ad-hoc before the migration
-- system was introduced or via direct ALTER) but no migration in this repo
-- adds them. Without these, certain endpoints raise UndefinedColumn errors.
-- All ALTER TABLE statements use IF NOT EXISTS so this is a no-op in prod.

-- cvc.partners — tech stack profile used by the partner terminal
ALTER TABLE cvc.partners
    ADD COLUMN IF NOT EXISTS tech_stack JSONB DEFAULT '{}'::jsonb;

-- cvc.company_lifecycle — newer "simplified" lifecycle uses status_changed_at
-- instead of the entered_at column from migration 006. The API queries the
-- newer column (cl.status_changed_at) and a `changed_by` plain-text column.
ALTER TABLE cvc.company_lifecycle
    ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS changed_by        TEXT,
    ADD COLUMN IF NOT EXISTS reason            TEXT;

CREATE INDEX IF NOT EXISTS idx_company_lifecycle_status_changed_at
    ON cvc.company_lifecycle (status_changed_at DESC);

-- cvc.build_tasks — the agent task queue uses task_type to segregate
-- DD/enrichment tasks from generic build tasks
ALTER TABLE cvc.build_tasks
    ADD COLUMN IF NOT EXISTS task_type TEXT;

CREATE INDEX IF NOT EXISTS idx_build_tasks_task_type
    ON cvc.build_tasks (task_type);

-- cvc.brambles_pipeline — additional analyst review fields used by the API
ALTER TABLE cvc.brambles_pipeline
    ADD COLUMN IF NOT EXISTS tier                 TEXT,
    ADD COLUMN IF NOT EXISTS tier_label           TEXT,
    ADD COLUMN IF NOT EXISTS composite_score      NUMERIC,
    ADD COLUMN IF NOT EXISTS strategic_rationale  TEXT,
    ADD COLUMN IF NOT EXISTS pdf_memo_path        TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- trend_report.* — separate schema for the trends/intelligence data warehouse.
-- Lives outside the cvc.* schema so it can be ETL'd independently. The API
-- and weekly_signals.py read/write these. We seed empty tables so endpoints
-- return [] instead of 500-ing locally.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS trend_report;

CREATE TABLE IF NOT EXISTS trend_report.raw_signals (
    id            SERIAL PRIMARY KEY,
    source_type   TEXT,
    source_name   TEXT,
    source_url    TEXT UNIQUE,
    title         TEXT,
    content       TEXT,
    published_at  TIMESTAMPTZ,
    sector_tags   TEXT[],
    signal_type   TEXT,
    quarter       TEXT,
    collected_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raw_signals_published ON trend_report.raw_signals (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_signals_quarter   ON trend_report.raw_signals (quarter);

CREATE TABLE IF NOT EXISTS trend_report.funding_events (
    id             SERIAL PRIMARY KEY,
    company_name   TEXT,
    company_id     INTEGER,
    round_type     TEXT,
    amount_usd     BIGINT,
    investors      TEXT[],
    event_date     DATE,
    source_url     TEXT,
    sector_tags    TEXT[],
    quarter        TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funding_events_quarter ON trend_report.funding_events (quarter);

CREATE TABLE IF NOT EXISTS trend_report.patent_signals (
    id                SERIAL PRIMARY KEY,
    company_name      TEXT,
    assignee          TEXT,
    patent_number     TEXT UNIQUE,
    title             TEXT,
    abstract          TEXT,
    ipc_codes         TEXT[],
    filing_date       DATE,
    publication_date  DATE,
    sector_tags       TEXT[],
    quarter           TEXT,
    collected_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trend_report.hiring_signals (
    id              SERIAL PRIMARY KEY,
    company_name    TEXT,
    company_id      INTEGER,
    role_title      TEXT,
    role_function   TEXT,
    location        TEXT,
    posted_at       DATE,
    snapshot_date   DATE,
    sector_tags     TEXT[],
    quarter         TEXT,
    collected_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- More production-only column additions discovered during local API smoke testing
-- ─────────────────────────────────────────────────────────────────────────────

-- cvc.notifications — target_user enables per-user inbox routing
ALTER TABLE cvc.notifications
    ADD COLUMN IF NOT EXISTS target_user TEXT;

-- cvc.funding_rounds — valuation_usd is queried by portfolio milestone-round route
ALTER TABLE cvc.funding_rounds
    ADD COLUMN IF NOT EXISTS valuation_usd BIGINT;

-- cvc.skirmishes — outputs (JSONB) tracks deliverables/results per skirmish
ALTER TABLE cvc.skirmishes
    ADD COLUMN IF NOT EXISTS outputs JSONB DEFAULT '{}'::jsonb;

-- cvc.partner_intros — status_log tracks PSM intro lifecycle, outcome flags result
ALTER TABLE cvc.partner_intros
    ADD COLUMN IF NOT EXISTS status_log JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS outcome    TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- cvc.content_items — ingested articles, podcasts, news for the intelligence feed.
-- Populated by SharpClaw / RSS collector. Used by the home dashboard, partners
-- intel section, and enrichment podcast queue.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cvc.content_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_type        VARCHAR(30),
    title               VARCHAR(1000),
    url                 VARCHAR(2000),
    source              TEXT,
    published_at        TIMESTAMPTZ,
    raw_text            TEXT,
    summary             TEXT,
    key_entities        JSONB DEFAULT '{}'::jsonb,
    tags                JSONB DEFAULT '[]'::jsonb,
    sentiment           VARCHAR(20),
    enrichment_status   VARCHAR(30) DEFAULT 'raw',
    podcast_synthesis   JSONB,
    article_synthesis   JSONB,
    briefing_flag       VARCHAR(30),
    content_hash        TEXT UNIQUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_items_created     ON cvc.content_items (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_items_type        ON cvc.content_items (content_type);
CREATE INDEX IF NOT EXISTS idx_content_items_status      ON cvc.content_items (enrichment_status);
CREATE INDEX IF NOT EXISTS idx_content_items_published   ON cvc.content_items (published_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- cvc.weekly_signals — weekly intelligence rollup used by the homepage briefing block
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cvc.weekly_signals (
    id                    SERIAL PRIMARY KEY,
    week_start            DATE NOT NULL,
    week_end              DATE,
    sector                TEXT,
    summary               TEXT,
    briefing_text         TEXT,
    total_items           INTEGER DEFAULT 0,
    podcast_count         INTEGER DEFAULT 0,
    news_count            INTEGER DEFAULT 0,
    article_count         INTEGER DEFAULT 0,
    sentiment_positive    INTEGER DEFAULT 0,
    sentiment_neutral     INTEGER DEFAULT 0,
    sentiment_negative    INTEGER DEFAULT 0,
    top_tags              JSONB DEFAULT '[]'::jsonb,
    top_companies         JSONB DEFAULT '[]'::jsonb,
    top_technologies      JSONB DEFAULT '[]'::jsonb,
    headlines             JSONB DEFAULT '[]'::jsonb,
    metrics               JSONB DEFAULT '{}'::jsonb,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weekly_signals_week_start ON cvc.weekly_signals (week_start DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- cvc.agent_memory — agent decision/event log. Used by /notifications.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cvc.agent_memory (
    id           SERIAL PRIMARY KEY,
    agent        TEXT NOT NULL,
    entry_type   TEXT NOT NULL,
    content      TEXT,
    metadata     JSONB DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_created ON cvc.agent_memory (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_memory_agent   ON cvc.agent_memory (agent);
