-- 000_local_bootstrap.sql — Local development bootstrap
--
-- Creates the foundational tables that are assumed to pre-exist in production
-- (originally populated via pg_dump). These are NOT created by any of the
-- numbered migrations because production already had them when the migration
-- system was introduced.
--
-- This file runs first (000_) so every subsequent migration can ADD COLUMN /
-- ALTER TABLE freely. All statements are idempotent — re-running has no effect.
-- In production these CREATE TABLE IF NOT EXISTS calls are no-ops because the
-- tables already exist (with potentially more columns from history).

CREATE SCHEMA IF NOT EXISTS cvc;

-- ─────────────────────────────────────────────────────────────────────────────
-- cvc.companies — the central company record
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cvc.companies (
    id                       SERIAL PRIMARY KEY,
    name                     TEXT NOT NULL,
    website                  TEXT,
    one_liner                TEXT,
    description              TEXT,
    sector                   TEXT,
    subsector                TEXT,
    stage                    TEXT,
    company_type             TEXT,
    business_model           TEXT,
    founded                  INTEGER,
    employee_count           INTEGER,
    employees                INTEGER,
    hq_city                  TEXT,
    hq_state                 TEXT,
    hq_country               TEXT,
    country                  TEXT,
    location                 TEXT,
    investors                TEXT[]  DEFAULT '{}',
    tags                     TEXT[]  DEFAULT '{}',
    verticals                TEXT[]  DEFAULT '{}',
    is_hardware              BOOLEAN DEFAULT FALSE,
    is_software              BOOLEAN DEFAULT FALSE,
    enrichment_status        TEXT    DEFAULT 'pending',
    enrichment_source        TEXT,
    enrichment_confidence    NUMERIC,
    enriched_at              TIMESTAMPTZ,
    raised_total             BIGINT,
    raised_usd_m             NUMERIC,
    total_raised_usd         BIGINT,
    last_round_date          DATE,
    last_round_stage         TEXT,
    score_composite          NUMERIC,
    score_irs                NUMERIC,
    score_sri                NUMERIC,
    score_tdf                NUMERIC,
    score_commercial         NUMERIC,
    score_technical          NUMERIC,
    score_market_timing      NUMERIC,
    score_partner_fit        NUMERIC,
    score_capital_eff        NUMERIC,
    scored_at                TIMESTAMPTZ,
    env_4d                   TEXT,
    func_4d                  TEXT,
    stack_4d                 TEXT,
    biz_model_4d             TEXT,
    news_articles            JSONB   DEFAULT '[]',
    case_studies             JSONB   DEFAULT '[]',
    case_study               TEXT,
    competitive_advantage    TEXT,
    background               TEXT,
    latest_investment_date   DATE,
    intel_sources            JSONB   DEFAULT '[]',
    notes                    TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_companies_name ON cvc.companies (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_companies_sector ON cvc.companies (sector);
CREATE INDEX IF NOT EXISTS idx_companies_enrichment_status ON cvc.companies (enrichment_status);

-- ─────────────────────────────────────────────────────────────────────────────
-- cvc.partners — corporate venture partners (also created by 005_partners.sql,
-- but 001_partner_documents.sql references it earlier)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cvc.partners (
    id                  SERIAL PRIMARY KEY,
    name                TEXT NOT NULL,
    industry            TEXT,
    contact_name        TEXT,
    contact_email       TEXT,
    challenge_areas     TEXT[],
    sectors_of_interest TEXT[],
    environments        TEXT[],
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- cvc.users — platform user accounts (also seeded in 083_users_roles.sql, but
-- 006_dealflow.sql FKs against it earlier in the migration order)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cvc.users (
    id                   SERIAL PRIMARY KEY,
    username             TEXT NOT NULL UNIQUE,
    password_hash        TEXT NOT NULL,
    role                 TEXT NOT NULL,
    full_name            TEXT,
    email                TEXT,
    assigned_partner_ids INT[] NOT NULL DEFAULT '{}',
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- cvc.partner_contracts — partner contract storage. Original prod columns were
-- created by ingest_contracts.py (contract_status, services_subscribed,
-- expiry_date, file_link, raw_summary, contract_value). Migration 070 then
-- adds the API-side columns (title, term_start, term_end, value, summary, etc.).
-- We seed everything up front so 070's UPDATE can backfill cleanly.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cvc.partner_contracts (
    id                  SERIAL PRIMARY KEY,
    partner_id          INTEGER REFERENCES cvc.partners(id) ON DELETE CASCADE,
    filename            TEXT,
    file_link           TEXT,
    file_type           TEXT,
    file_data           BYTEA,
    summary             TEXT,
    raw_summary         TEXT,
    title               TEXT,
    contract_status     TEXT DEFAULT 'Active',
    contract_value      NUMERIC,
    services_subscribed JSONB,
    term_start          DATE,
    term_end            DATE,
    expiry_date         DATE,
    value               NUMERIC,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- cvc.partner_documents — created by both 001 and 033 with different columns.
-- We seed the union of columns so the GIN(raw_text) index in 033 can build.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cvc.partner_documents (
    id            SERIAL PRIMARY KEY,
    partner_id    INTEGER NOT NULL REFERENCES cvc.partners(id) ON DELETE CASCADE,
    filename      TEXT NOT NULL,
    file_type     TEXT NOT NULL,
    file_data     BYTEA,
    file_size     INTEGER,
    raw_text      TEXT,
    source_label  TEXT,
    parsed        BOOLEAN DEFAULT FALSE,
    uploaded_at   TIMESTAMPTZ DEFAULT NOW(),
    uploaded_by   TEXT
);

CREATE INDEX IF NOT EXISTS idx_partner_documents_partner_id ON cvc.partner_documents(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_documents_uploaded_at ON cvc.partner_documents(uploaded_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- cvc.partner_notes — created in 033 alongside partner_documents. Seeded here
-- because 084_partner_visibility.sql references it before some local runs hit 033.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cvc.partner_notes (
    id          SERIAL PRIMARY KEY,
    partner_id  INTEGER NOT NULL REFERENCES cvc.partners(id) ON DELETE CASCADE,
    body        TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    created_by  TEXT DEFAULT 'nate'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- cvc.partner_issues — open partner issues / action items
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cvc.partner_issues (
    id                  SERIAL PRIMARY KEY,
    partner_id          INTEGER REFERENCES cvc.partners(id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    body                TEXT,
    severity            TEXT CHECK (severity IN ('high', 'medium', 'low')) DEFAULT 'medium',
    due_date            DATE,
    linked_document_id  INTEGER,
    resolved            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- cvc.funding_rounds — formal funding round records
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cvc.funding_rounds (
    id                SERIAL PRIMARY KEY,
    company_id        INTEGER NOT NULL REFERENCES cvc.companies(id) ON DELETE CASCADE,
    round_type        TEXT,
    amount_usd        BIGINT,
    announced_date    DATE,
    investors         TEXT[],
    source            TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funding_rounds_company ON cvc.funding_rounds (company_id);
CREATE INDEX IF NOT EXISTS idx_funding_rounds_announced ON cvc.funding_rounds (announced_date DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- cvc.brambles_pipeline — Brambles Strategic Fund pipeline rows
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cvc.brambles_pipeline (
    id                  SERIAL PRIMARY KEY,
    company_name        TEXT NOT NULL,
    website             TEXT,
    one_liner           TEXT,
    employees           INTEGER,
    founded_year        INTEGER,
    hq                  TEXT,
    sector              TEXT,
    funding_stage       TEXT,
    raised_usd_m        NUMERIC,
    tech_stack_layer    TEXT,
    relevant_process    TEXT,
    analyst_rationale   TEXT,
    analyst_tier        TEXT,
    status              TEXT DEFAULT 'pending',
    enrichment_status   TEXT DEFAULT 'pending',
    review_status       TEXT DEFAULT 'pending',
    ic_memo_json        JSONB,
    review_memo_json    JSONB,
    review_memo_path    TEXT,
    pdf_appendix_path   TEXT,
    excel_path          TEXT,
    added_by            TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- cvc.brambles_feedback — analyst feedback per claim
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cvc.brambles_feedback (
    id            SERIAL PRIMARY KEY,
    company_id    INTEGER NOT NULL REFERENCES cvc.brambles_pipeline(id) ON DELETE CASCADE,
    section       TEXT NOT NULL,
    item_index    INTEGER NOT NULL,
    item_text     TEXT,
    verdict       TEXT,
    note          TEXT,
    reviewed_by   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(company_id, section, item_index)
);
