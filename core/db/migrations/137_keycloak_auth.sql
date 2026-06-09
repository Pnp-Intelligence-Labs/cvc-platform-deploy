-- Migration 137: Keycloak SSO support
-- Adds keycloak_sub for KC-authenticated users.
-- Drops NOT NULL on password_hash so KC users don't need a local password.

ALTER TABLE cvc.users ADD COLUMN IF NOT EXISTS keycloak_sub TEXT;

ALTER TABLE cvc.users ALTER COLUMN password_hash DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_keycloak_sub_idx
    ON cvc.users(keycloak_sub)
    WHERE keycloak_sub IS NOT NULL;
