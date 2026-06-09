-- 140_mfa_and_lockout.sql
-- Phase 2 auth hardening: account lockout, password history, MFA
-- (ISO 27001 A.8.5 / NIST 3.5 / SOC 2 CC6.1)

-- Account lockout (5 failures → 30-min lock)
CREATE TABLE IF NOT EXISTS cvc.auth_lockouts (
    user_id       INTEGER PRIMARY KEY REFERENCES cvc.users(id) ON DELETE CASCADE,
    attempt_count INTEGER NOT NULL DEFAULT 1,
    locked_until  TIMESTAMPTZ DEFAULT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Password history (last 5 hashes, prevents reuse)
CREATE TABLE IF NOT EXISTS cvc.user_password_history (
    id         BIGSERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES cvc.users(id) ON DELETE CASCADE,
    pw_hash    TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pw_history_user ON cvc.user_password_history(user_id, created_at DESC);

-- MFA fields on users (TOTP-based, RFC 6238)
ALTER TABLE cvc.users
    ADD COLUMN IF NOT EXISTS mfa_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS mfa_secret_enc TEXT    DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS mfa_confirmed  BOOLEAN NOT NULL DEFAULT FALSE;
