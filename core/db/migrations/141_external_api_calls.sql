-- 141_external_api_calls.sql
-- Audit log for outbound calls to third-party APIs (ISO 27001 A.5.19 / SOC 2 CC9.2)
-- Covers: OpenRouter (LLM), ProxyCurl, Brave Search, HIBP, Google Drive

CREATE TABLE IF NOT EXISTS cvc.external_api_calls (
    id              BIGSERIAL PRIMARY KEY,
    service         TEXT NOT NULL,          -- 'openrouter' | 'proxycurl' | 'brave' | 'hibp' | 'google_drive'
    endpoint        TEXT,                   -- specific endpoint or operation label
    user_id         INTEGER REFERENCES cvc.users(id) ON DELETE SET NULL,
    data_class      TEXT NOT NULL DEFAULT 'internal',  -- public | internal | confidential | restricted
    pii_stripped    BOOLEAN NOT NULL DEFAULT FALSE,    -- TRUE if PII was removed before sending
    rows_sent       INTEGER DEFAULT 0,                 -- number of records / tokens in payload
    response_status INTEGER,                           -- HTTP status returned
    duration_ms     INTEGER,
    detail          TEXT,                              -- extra context (model name, query type, etc.)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ext_api_service    ON cvc.external_api_calls(service);
CREATE INDEX IF NOT EXISTS idx_ext_api_user_id    ON cvc.external_api_calls(user_id);
CREATE INDEX IF NOT EXISTS idx_ext_api_created_at ON cvc.external_api_calls(created_at DESC);
