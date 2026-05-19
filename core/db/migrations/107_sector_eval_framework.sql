-- Migration 107: Sector Evaluation Framework
-- Per-associate importance weights by sector + stage, with a forced-ranking budget system

-- Field catalog (default fields + user-added custom fields)
CREATE TABLE IF NOT EXISTS cvc.sector_eval_fields (
    id          SERIAL PRIMARY KEY,
    section     TEXT NOT NULL,       -- 'Team', 'Market', 'Technology', 'Business'
    field_name  TEXT NOT NULL,
    description TEXT,
    is_default  BOOLEAN DEFAULT TRUE,
    created_by  TEXT,                -- NULL for default fields, username for custom
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(field_name)
);

-- Per-user, per-sector, per-stage importance ratings
CREATE TABLE IF NOT EXISTS cvc.sector_eval_weights (
    id          SERIAL PRIMARY KEY,
    evaluator   TEXT NOT NULL,
    sector      TEXT NOT NULL,
    stage       TEXT NOT NULL,
    field_id    INT  REFERENCES cvc.sector_eval_fields(id) ON DELETE CASCADE,
    importance  INT  CHECK (importance BETWEEN 1 AND 5),
    saved_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(evaluator, sector, stage, field_id)
);

CREATE INDEX IF NOT EXISTS idx_sew_evaluator_sector_stage
    ON cvc.sector_eval_weights (evaluator, sector, stage);

CREATE INDEX IF NOT EXISTS idx_sew_field_id
    ON cvc.sector_eval_weights (field_id);

-- Seed 10 default evaluation fields (2 per section, 4 sections + 2 extra in Business)
INSERT INTO cvc.sector_eval_fields (section, field_name, description, is_default) VALUES
('Team',
 'Founding Team Quality',
 'Technical depth, operator experience, coachability, and prior domain exits. Is this team uniquely positioned to win in this space, or could any competent team do it?',
 TRUE),

('Team',
 'Team Completeness',
 'All key roles present: technical lead, commercial owner, operational depth. CEO/CTO split health, hiring velocity, single-point-of-failure risk.',
 TRUE),

('Market',
 'Market Size & Timing',
 'Realistic TAM/SAM/SOM with bottom-up logic. Is the market being created or captured? Is timing a tailwind or headwind — are customers already looking for this?',
 TRUE),

('Market',
 'Customer Pull Evidence',
 'Inbound demand signals, pilot-to-paid conversion rate, reference customers, signed LOIs. Genuine pull vs. founder push. Can they name three referenceable buyers?',
 TRUE),

('Technology',
 'Technical Defensibility',
 'IP, patents, trade secrets, switching costs, and build-time advantage. Can a well-funded competitor reproduce this in 12-18 months? What is the moat?',
 TRUE),

('Technology',
 'Product Maturity',
 'Development stage: prototype vs. production-ready vs. deployed at scale. Integration complexity for target customers. Difference between a POC and a contracted deployment.',
 TRUE),

('Business',
 'Business Model Clarity',
 'Clear path to recurring revenue, pricing power, and favorable unit economics. Does the model scale without proportional cost growth? Is the revenue model right for the sector?',
 TRUE),

('Business',
 'Competitive Position',
 'Differentiation vs. incumbents, well-funded startups, and internal corporate builds. What prevents displacement in 3-5 years? Network effects, data moats, or switching costs?',
 TRUE),

('Business',
 'Capital Efficiency',
 'Milestone cost, burn rate, and runway. How far does a CVC check get them toward the next fundable signal? Follow-on fundability from Tier 1 VCs.',
 TRUE),

('Business',
 'CVC Thesis Fit',
 'Alignment with the industrial-sector investment thesis and corporate partner value-add potential. Can CVC uniquely accelerate this company through introductions, pilots, or distribution?',
 TRUE)
ON CONFLICT (field_name) DO NOTHING;

-- Update the Evaluation by Sector assignment with instructions
UPDATE cvc.venture_assignments
SET notes = 'Complete one evaluation per sector × stage combination relevant to your coverage area. Use the 25-point budget to force-rank what matters most at each stage — you cannot rate everything Critical. Rules: (1) max 2 fields can be Critical (5 pts); (2) at least 2 fields must be Minimal or Low (1-2 pts); (3) all fields must be rated before saving. Use "Stage Defaults" as a starting point, then adjust based on your view of each sector. Your weights are compared across the team to surface investment philosophy differences and alignment gaps.'
WHERE id = 3;
