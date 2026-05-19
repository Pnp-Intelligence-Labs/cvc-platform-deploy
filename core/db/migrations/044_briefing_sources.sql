-- Migration 044: briefing_sources
-- Stores monitored news/podcast sources for the Intelligence Briefing pipeline.

CREATE TABLE IF NOT EXISTS cvc.briefing_sources (
    id           SERIAL PRIMARY KEY,
    name         TEXT NOT NULL,
    url          TEXT,
    source_type  TEXT NOT NULL DEFAULT 'rss',   -- 'rss', 'podcast', 'youtube', 'newsletter', 'manual'
    category     TEXT,                           -- e.g. 'supply chain', 'robotics', 'industrials'
    active       BOOLEAN NOT NULL DEFAULT TRUE,
    notes        TEXT,
    added_by     TEXT DEFAULT 'nate',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_briefing_sources_active ON cvc.briefing_sources(active);
CREATE INDEX IF NOT EXISTS idx_briefing_sources_type   ON cvc.briefing_sources(source_type);

-- Seed with sources already in the enrichment pipeline
INSERT INTO cvc.briefing_sources (name, url, source_type, category, notes) VALUES
  ('Supply Chain Now',             'https://www.youtube.com/@SupplyChainNow',              'youtube',   'supply chain',  'Scott Luton — weekly interview show'),
  ('Transformation Ground Control','https://www.youtube.com/@TransformationGroundControl', 'youtube',   'ERP / enterprise software', 'Eric Kimberling'),
  ('Third Stage Consulting',       'https://www.youtube.com/@ThirdStageConsulting',        'youtube',   'ERP / enterprise software', 'Eric Kimberling'),
  ('Physical Intelligence',        'https://www.youtube.com/@physicalintelligence3d',      'youtube',   'robotics / physical AI',    'Research-focused'),
  ('Gartner Supply Chain',         'https://www.gartner.com/en/supply-chain',              'newsletter','supply chain',  'Analyst coverage — CSCOs, trends')
ON CONFLICT DO NOTHING;
