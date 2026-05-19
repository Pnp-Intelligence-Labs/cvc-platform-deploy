-- Migration 059: enrichment_snapshots
-- Daily coverage snapshots for tracking enrichment progress over time.
-- Each row is a point-in-time count of how many companies have each field populated.

CREATE TABLE IF NOT EXISTS cvc.enrichment_snapshots (
    id               SERIAL PRIMARY KEY,
    snapshot_date    DATE NOT NULL UNIQUE,
    total_companies  INT NOT NULL DEFAULT 0,

    -- CSV import baseline
    has_one_liner        INT NOT NULL DEFAULT 0,
    has_description      INT NOT NULL DEFAULT 0,
    has_website          INT NOT NULL DEFAULT 0,
    has_founded          INT NOT NULL DEFAULT 0,
    has_hq_city          INT NOT NULL DEFAULT 0,
    has_employee_count   INT NOT NULL DEFAULT 0,
    has_total_raised     INT NOT NULL DEFAULT 0,
    has_investors        INT NOT NULL DEFAULT 0,

    -- Phase 1 enrichment
    has_4d               INT NOT NULL DEFAULT 0,
    has_subsector        INT NOT NULL DEFAULT 0,

    -- Phase 2 enrichment
    has_score            INT NOT NULL DEFAULT 0,
    has_commercial_signals INT NOT NULL DEFAULT 0,
    has_funding_rounds   INT NOT NULL DEFAULT 0,
    has_industrial_score INT NOT NULL DEFAULT 0,
    has_protocol_support INT NOT NULL DEFAULT 0,
    has_verified_certs   INT NOT NULL DEFAULT 0,

    -- Deep enrichment (Brave Search)
    has_news_articles    INT NOT NULL DEFAULT 0,
    has_case_studies     INT NOT NULL DEFAULT 0,

    -- Manual / targeted enrichment
    has_founders         INT NOT NULL DEFAULT 0,
    has_linkedin         INT NOT NULL DEFAULT 0,

    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE cvc.enrichment_snapshots IS
  'Daily snapshot of field coverage counts across all companies. Written by workers/enrichment/coverage_snapshot.py.';
