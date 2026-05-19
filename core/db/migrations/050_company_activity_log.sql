CREATE TABLE IF NOT EXISTS cvc.company_activity_log (
    id          BIGSERIAL PRIMARY KEY,
    company_id  INT NOT NULL REFERENCES cvc.companies(id) ON DELETE CASCADE,
    changed_by  TEXT NOT NULL DEFAULT 'system',
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    field_name  TEXT NOT NULL,
    old_value   TEXT,
    new_value   TEXT,
    change_source TEXT NOT NULL DEFAULT 'manual'
);
CREATE INDEX IF NOT EXISTS idx_company_activity_log_company ON cvc.company_activity_log (company_id, changed_at DESC);
