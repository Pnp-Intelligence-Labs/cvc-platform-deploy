-- Migration 121: Scrum items (product ideas, PoCs, MVPs)
CREATE TABLE IF NOT EXISTS cvc.scrum_items (
    id              SERIAL PRIMARY KEY,
    title           TEXT NOT NULL,
    category        TEXT NOT NULL DEFAULT 'product',  -- product, poc, mvp, feature
    overview        TEXT,
    owner           TEXT,
    target_customer TEXT,
    revenue_model   TEXT,
    key_features    TEXT,
    platform_link   TEXT,
    status          TEXT NOT NULL DEFAULT 'exploring', -- exploring, building, live, paused, shelved
    created_by      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cvc.scrum_updates (
    id         SERIAL PRIMARY KEY,
    item_id    INT NOT NULL REFERENCES cvc.scrum_items(id) ON DELETE CASCADE,
    author     TEXT NOT NULL,
    body       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed: Brambles DD Platform
INSERT INTO cvc.scrum_items (title, category, overview, owner, target_customer, revenue_model, key_features, platform_link, status, created_by)
VALUES (
    'Brambles DD Platform',
    'product',
    'A white-label due diligence intelligence platform built on the CVC DD engine. Allows corporate partners and institutional investors to run structured, AI-assisted DD on startup companies — producing IC memos, scorecards, and analyst review workflows.',
    'admin',
    'Strategic corporate partners, institutional VCs, family offices, and investment teams at corporates who evaluate startups but lack structured DD infrastructure.',
    'SaaS licensing per seat or per-run. Estimated $15-30K/year per client for unlimited runs; or $500-1,500 per DD report on a transactional basis. White-label branding add-on.',
    'AI-powered IC memo generation with evidence-cited claims; analyst review workflow with verdict system; PDF + DOCX output; scorecard with configurable weights; learning feedback loop across runs; partner-configurable thesis and criteria.',
    '/brambles',
    'live',
    'admin'
);
