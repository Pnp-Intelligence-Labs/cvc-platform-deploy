-- Migration 077: platform_settings — centralized LLM prompt context
-- Replaces hardcoded thesis/context strings scattered across workers.

CREATE TABLE IF NOT EXISTS cvc.platform_settings (
    key         VARCHAR PRIMARY KEY,
    value       TEXT NOT NULL,
    description TEXT
);

INSERT INTO cvc.platform_settings (key, value, description) VALUES
(
    'investment_thesis',
    'Pre-seed to Series A fund focused on supply chain, industrials, and robotics.',
    'Core fund focus statement used in LLM prompts'
),
(
    'corporate_partners_context',
    'CVC advises ~25 Fortune 500 corporate partners including Walmart, Amazon, Honeywell, Caterpillar, John Deere, Siemens, ABB, Rockwell Automation, Parker Hannifin, Emerson Electric, Zebra Technologies, and Carrier Global.',
    'F500 advisory context for LLM prompts'
),
(
    'sector_focus',
    '- Supply chain, logistics, warehousing, fulfillment
- Robotics, automation, industrial technology
- Venture capital, startup funding, M&A
- Enterprise technology, ERP, digital transformation
- Macroeconomics, trade policy, tariffs, markets
- Corporate strategy, executive leadership, earnings',
    'Sector focus bullet list for content relevance scoring'
),
(
    'analyst_context',
    'A firm that advises Fortune 500 companies on startup partnerships and invests in pre-seed to Series A supply chain/industrial startups.',
    'Firm description for enrichment and synthesis prompts'
)
ON CONFLICT (key) DO NOTHING;
