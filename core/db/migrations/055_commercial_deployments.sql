-- Migration 055: Commercial Deployments table
-- Tracks customer contracts per company with stealth mode for NDA-sensitive entries

CREATE TABLE IF NOT EXISTS cvc.commercial_deployments (
    id              SERIAL PRIMARY KEY,
    company_id      INTEGER NOT NULL REFERENCES cvc.companies(id) ON DELETE CASCADE,
    customer_name   TEXT,
    deployment_type TEXT NOT NULL,   -- 'Paid Pilot', 'Commercial Deployment', 'PoC', 'LOI', 'Renewal', 'Enterprise'
    contract_value_usd INTEGER,      -- NULL = undisclosed
    start_date      DATE,
    end_date        DATE,
    stealth         BOOLEAN NOT NULL DEFAULT FALSE,  -- blur customer name when true
    notes           TEXT,
    added_by        TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commercial_deployments_company ON cvc.commercial_deployments(company_id);
