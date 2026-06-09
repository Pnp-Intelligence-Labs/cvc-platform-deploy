-- 139_auth_hardening.sql
-- Token revocation support (NIST 3.1.3 / SOC 2 CC6.1)
-- When a user is deactivated or resets their password, all previously issued
-- JWTs become invalid: require_jwt checks iat > token_invalidated_at.

ALTER TABLE cvc.users
    ADD COLUMN IF NOT EXISTS token_invalidated_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN cvc.users.token_invalidated_at IS
    'Tokens issued before this timestamp are rejected. Set on deactivation and password reset.';
