-- Migration 084: Partner Terminal Visibility Tags
-- Phase 1.4 of Platform Foundation build
-- Adds visibility and assigned_psm to 5 partner terminal tables.
-- Creates access log table for audit trail.
-- Additive only — no existing data touched.
-- Safe to re-run (all IF NOT EXISTS / idempotent).

-- ── Visibility columns ─────────────────────────────────────────────────────────
-- visibility: 'team' (all users) | 'psm_only' (assigned PSM + GP/Principal/Director) | 'gp_only' (GP/Principal/Director only)
-- assigned_psm: username of the PSM this row belongs to (only meaningful when visibility='psm_only')

ALTER TABLE cvc.partner_documents
    ADD COLUMN IF NOT EXISTS visibility   TEXT NOT NULL DEFAULT 'team',
    ADD COLUMN IF NOT EXISTS assigned_psm TEXT;

ALTER TABLE cvc.partner_problems
    ADD COLUMN IF NOT EXISTS visibility   TEXT NOT NULL DEFAULT 'team',
    ADD COLUMN IF NOT EXISTS assigned_psm TEXT;

ALTER TABLE cvc.partner_notes
    ADD COLUMN IF NOT EXISTS visibility   TEXT NOT NULL DEFAULT 'team',
    ADD COLUMN IF NOT EXISTS assigned_psm TEXT;

ALTER TABLE cvc.partner_advisory_logs
    ADD COLUMN IF NOT EXISTS visibility   TEXT NOT NULL DEFAULT 'team',
    ADD COLUMN IF NOT EXISTS assigned_psm TEXT;

ALTER TABLE cvc.partner_issue_comments
    ADD COLUMN IF NOT EXISTS visibility   TEXT NOT NULL DEFAULT 'team',
    ADD COLUMN IF NOT EXISTS assigned_psm TEXT;

-- ── Access log ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cvc.partner_terminal_access_log (
    id         SERIAL PRIMARY KEY,
    username   TEXT NOT NULL,
    role       TEXT NOT NULL,
    partner_id INT  NOT NULL,
    action     TEXT NOT NULL,   -- 'view_documents' | 'view_problems' | 'view_notes' | etc.
    accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ptacl_partner ON cvc.partner_terminal_access_log (partner_id);
CREATE INDEX IF NOT EXISTS idx_ptacl_user    ON cvc.partner_terminal_access_log (username);
