CREATE TABLE cvc.research_queue (
    id SERIAL PRIMARY KEY,
    company_name TEXT NOT NULL,
    company_id INTEGER REFERENCES cvc.companies(id),
    website TEXT,
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'pending',
    requested_by TEXT DEFAULT 'audit_weekly',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    notes TEXT
);

CREATE INDEX ON cvc.research_queue(status);
CREATE INDEX ON cvc.research_queue(company_id);