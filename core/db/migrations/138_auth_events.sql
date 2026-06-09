-- 138_auth_events.sql
-- Audit log for authentication events (ISO 27001 A.8.15 / NIST 3.3 / SOC 2 CC7.2)

CREATE TABLE IF NOT EXISTS cvc.auth_events (
    id           BIGSERIAL PRIMARY KEY,
    user_id      INTEGER REFERENCES cvc.users(id) ON DELETE SET NULL,
    username     TEXT,                    -- stored separately so it survives user deletion
    event_type   TEXT NOT NULL,           -- login_success | login_failure | sso_login | logout
                                          -- token_refresh | password_reset | user_created
                                          -- user_deactivated | mfa_setup | mfa_failure
    ip_address   TEXT,
    user_agent   TEXT,
    success      BOOLEAN NOT NULL DEFAULT TRUE,
    detail       TEXT,                    -- extra context (e.g. failure reason, acting admin)
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_events_user_id    ON cvc.auth_events(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_events_event_type ON cvc.auth_events(event_type);
CREATE INDEX IF NOT EXISTS idx_auth_events_created_at ON cvc.auth_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_events_ip         ON cvc.auth_events(ip_address);
