-- Migration 108: Expand sector evaluation fields from 10 → 19
-- Adds 9 new fields across Team, Market, Technology, and Business sections.
-- Budget system auto-scales in the React component: round(default_count × 2.5) = 48 pts.

INSERT INTO cvc.sector_eval_fields (section, field_name, description, is_default) VALUES

-- Team additions ---------------------------------------------------------------
('Team',
 'Founder-Market Fit',
 'Have the founders lived this problem firsthand? Do they have an unfair advantage in understanding this market — through a prior job, industry network, or personal experience — that an outsider cannot replicate?',
 TRUE),

('Team',
 'Talent Density & Velocity',
 'Quality of the first 10-20 hires beyond the founding team. Are they attracting people who left strong jobs to join? How fast are they building the team relative to capital raised?',
 TRUE),

-- Market additions -------------------------------------------------------------
('Market',
 'Market Structure',
 'Is the market fragmented or consolidated? How do incumbents respond to new entrants — acquire, ignore, or crush? What are the procurement cycles and budget ownership dynamics at target customers?',
 TRUE),

('Market',
 'Macro & Regulatory Tailwinds',
 'Reshoring policy, defense budgets, IRA/CHIPS Act incentives, ESG mandates, supply chain legislation. Does the external environment create urgency or mandate adoption independent of product quality?',
 TRUE),

-- Technology additions ---------------------------------------------------------
('Technology',
 'Integration Complexity',
 'How difficult is it to deploy this product in a customer''s live environment? Long integration timelines, legacy system dependencies, and IT approval processes are risk multipliers — score lower for higher complexity.',
 TRUE),

('Technology',
 'Data & Network Effects',
 'Does the product compound in value with more users, more deployments, or more data? A product that learns and improves over time creates a widening moat. Score the strength of the flywheel.',
 TRUE),

-- Business additions -----------------------------------------------------------
('Business',
 'Revenue Quality',
 'Recurring vs. project-based revenue, net revenue retention, contract length and structure. ARR with high NRR and multi-year contracts scores highest. One-time project revenue scores lowest.',
 TRUE),

('Business',
 'Exit Pathways & Acquirer Universe',
 'Breadth and quality of realistic exit scenarios: M&A (who are the strategic acquirers?), PE rollup, or IPO. A crowded acquirer universe with clear strategic logic scores highest.',
 TRUE),

('Business',
 'Industrial Resilience & Sovereignty',
 'Does this company support domestic manufacturing, supply chain independence, or national security applications? Applicability to defense, critical infrastructure, or reshoring mandates creates a floor on strategic value.',
 TRUE)

ON CONFLICT (field_name) DO NOTHING;
