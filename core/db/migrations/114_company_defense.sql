-- Migration 114: company_defense capability table
-- Defense-sector analogue of company_robotics.
-- Tracks platform type, application domain, deployment stage,
-- customer type, and technology readiness for defense companies.

CREATE TABLE IF NOT EXISTS cvc.company_defense (
    company_id          INTEGER PRIMARY KEY REFERENCES cvc.companies(id) ON DELETE CASCADE,

    -- What is it?
    platform_type       TEXT,           -- UAV, UGV, USV, C2 Software, ISR, Counter-UAS, Cybersecurity, Directed Energy, Other
    application         TEXT,           -- Reconnaissance, Strike, Logistics, EW, Communications, Training, Other

    -- Maturity
    deployment_stage    VARCHAR(100),   -- R&D, Prototype, Fielded, Program of Record
    trl                 SMALLINT CHECK (trl BETWEEN 1 AND 9),  -- Technology Readiness Level

    -- Customer & contract profile
    customer_type       TEXT,           -- DoD, NATO, Commercial, Dual-Use
    prime_or_sub        TEXT,           -- Prime, Sub-contractor, Pure-Play

    -- Compliance flag
    export_controlled   BOOLEAN,        -- TRUE = ITAR/EAR controlled

    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE cvc.company_defense IS
    'Defense-sector capability matrix. One row per defense portfolio/pipeline company.';
