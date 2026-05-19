-- Migration 083: Users and Roles
-- Phase 1.1 of Platform Foundation build
-- Creates cvc.roles and cvc.users tables.
-- Additive only — no existing tables modified.
-- Safe to re-run (all IF NOT EXISTS).

-- Roles lookup table
CREATE TABLE IF NOT EXISTS cvc.roles (
    role        TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed roles (idempotent)
INSERT INTO cvc.roles (role, description) VALUES
    ('GP',        'General Partner — full access to everything'),
    ('Principal', 'Principal / Director — full access except build configuration'),
    ('Director',  'Director — full access except build configuration'),
    ('Ventures',  'Ventures team — sourcing, companies, DD pipeline, deal flow, LP fund data'),
    ('PSM',       'Partner Success Manager — assigned partners only, no LP fund data')
ON CONFLICT (role) DO NOTHING;

-- Users table
CREATE TABLE IF NOT EXISTS cvc.users (
    id                   SERIAL PRIMARY KEY,
    username             TEXT NOT NULL UNIQUE,
    password_hash        TEXT NOT NULL,
    role                 TEXT NOT NULL REFERENCES cvc.roles(role),
    full_name            TEXT,
    email                TEXT,
    assigned_partner_ids INT[] NOT NULL DEFAULT '{}',
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed a default admin user.
-- Default password is "changeme" — rotate immediately on first login.
INSERT INTO cvc.users (username, password_hash, role, full_name, email)
VALUES (
    'admin',
    '$2b$12$STRQmHpsYvBDFJ5AoprsCeVc0Oo0.B6/bofKMpJiZTrOjc5IcLSZe',
    'GP',
    'Admin',
    ''
)
ON CONFLICT (username) DO NOTHING;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION cvc.update_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_updated_at ON cvc.users;
CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON cvc.users
    FOR EACH ROW EXECUTE FUNCTION cvc.update_users_updated_at();
