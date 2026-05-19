-- Migration 101: Sales Pipeline
-- Creates sales_targets, sales_contacts, sales_notes tables
-- Run on Dell: psql -U producer -d cvc_db -f 101_sales_pipeline.sql

BEGIN;

-- ── Sales Targets ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cvc.sales_targets (
    id                  serial PRIMARY KEY,
    company_name        text NOT NULL,
    website             text,
    sector              text,
    assigned_to         text,
    stage               text NOT NULL DEFAULT 'target',  -- target, nurturing, proposal, closed_won, closed_lost
    rationale           text,
    est_deal_type       text,       -- LP, Corporate Partner, Strategic, Pilot
    est_deal_value      numeric,
    target_close_date   date,
    signed_date         date,
    contract_value      numeric,
    contract_term_months int,
    proposed_deliverables text[],
    stage_gate_data     jsonb NOT NULL DEFAULT '{}',
    partner_id          int REFERENCES cvc.partners(id) ON DELETE SET NULL,
    created_by          text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    stage_changed_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Sales Contacts ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cvc.sales_contacts (
    id               serial PRIMARY KEY,
    target_id        int NOT NULL REFERENCES cvc.sales_targets(id) ON DELETE CASCADE,
    full_name        text NOT NULL,
    title            text,
    email            text,
    phone            text,
    is_decision_maker bool NOT NULL DEFAULT false,
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── Sales Notes ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cvc.sales_notes (
    id          serial PRIMARY KEY,
    target_id   int NOT NULL REFERENCES cvc.sales_targets(id) ON DELETE CASCADE,
    note_type   text NOT NULL DEFAULT 'general',   -- call, email, meeting, general
    body        text NOT NULL,
    author      text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sales_targets_stage       ON cvc.sales_targets(stage);
CREATE INDEX IF NOT EXISTS idx_sales_targets_assigned_to ON cvc.sales_targets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_sales_contacts_target_id  ON cvc.sales_contacts(target_id);
CREATE INDEX IF NOT EXISTS idx_sales_notes_target_id     ON cvc.sales_notes(target_id);

COMMIT;
