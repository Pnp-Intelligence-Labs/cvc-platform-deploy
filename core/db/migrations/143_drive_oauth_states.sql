-- Migration 143: DB-backed Drive OAuth state nonces
-- Replaces in-memory _states dict in core/drive/userauth.py so state
-- survives Railway container restarts between auth-url and callback.
CREATE TABLE IF NOT EXISTS cvc.drive_oauth_states (
    state       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    return_to   TEXT    NOT NULL DEFAULT 'ingest',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
