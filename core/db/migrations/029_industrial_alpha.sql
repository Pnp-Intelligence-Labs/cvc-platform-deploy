-- Migration 029: Industrial Alpha columns for cvc.companies
-- Owned by Sharp Claw. Populated during Phase 3 enrichment (sector IN Robotics/Manufacturing/Energy/Logistics).
-- See sharpclaw/INDUSTRIAL_ALPHA.md for extraction protocol.

ALTER TABLE cvc.companies
    ADD COLUMN IF NOT EXISTS industrial_readiness_score INT,      -- 1-10 composite score (interop + deployment + certs + TCO)
    ADD COLUMN IF NOT EXISTS sovereignty_score          INT,      -- 1-10 geopolitical resilience (TAA-compliance, friend-shoring)
    ADD COLUMN IF NOT EXISTS protocol_support           JSONB,    -- e.g. ["OPC-UA", "ROS2", "MQTT"]
    ADD COLUMN IF NOT EXISTS deployment_signal_level    TEXT,     -- 'Lab-Stage' | 'Pilot' | 'Scaling' | 'Operational'
    ADD COLUMN IF NOT EXISTS verified_certs             JSONB,    -- e.g. ["ISO 10218-1/2:2025", "UL 1741", "IEC 61508"]
    ADD COLUMN IF NOT EXISTS integration_notes          TEXT;     -- Sharp Claw narrative: partner pilot advice, gaps, risks

-- Constraints (IF NOT EXISTS not supported for constraints — use DO block)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_industrial_readiness_score') THEN
        ALTER TABLE cvc.companies ADD CONSTRAINT chk_industrial_readiness_score CHECK (industrial_readiness_score BETWEEN 1 AND 10);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_sovereignty_score') THEN
        ALTER TABLE cvc.companies ADD CONSTRAINT chk_sovereignty_score CHECK (sovereignty_score BETWEEN 1 AND 10);
    END IF;
END $$;

-- Indexes for dashboard filtering
CREATE INDEX IF NOT EXISTS idx_companies_industrial_score
    ON cvc.companies(industrial_readiness_score)
    WHERE industrial_readiness_score IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_companies_sovereignty_score
    ON cvc.companies(sovereignty_score)
    WHERE sovereignty_score IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_companies_deployment_signal
    ON cvc.companies(deployment_signal_level)
    WHERE deployment_signal_level IS NOT NULL;
