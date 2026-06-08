-- 139_user_permissions: per-user custom permission grants (beyond role defaults)
CREATE TABLE IF NOT EXISTS cvc.user_permissions (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES cvc.users(id) ON DELETE CASCADE,
    permission  TEXT NOT NULL,
    granted_by  TEXT NOT NULL,
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, permission)
);
CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON cvc.user_permissions(user_id);
