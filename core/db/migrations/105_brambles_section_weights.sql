-- Migration 105: Brambles section-level importance weights
-- Tracks what CVC places importance on per section, indexed by startup type + stage.
-- Enables querying: "For AI/ML at Seed, we rate Founders as Critical."

CREATE TABLE IF NOT EXISTS cvc.brambles_section_weights (
    id          SERIAL PRIMARY KEY,
    pipeline_id INT  NOT NULL REFERENCES cvc.brambles_pipeline(id) ON DELETE CASCADE,
    startup_type TEXT,                     -- e.g. 'Robotics / Automation', 'AI / Machine Learning'
    stage_group  TEXT,                     -- 'early' | 'growth' | 'late'
    section      TEXT NOT NULL,            -- matches review section keys
    importance   INT  NOT NULL CHECK (importance BETWEEN 1 AND 5),
    set_by       TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (pipeline_id, section)
);

CREATE INDEX IF NOT EXISTS idx_bsw_pipeline   ON cvc.brambles_section_weights(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_bsw_type_stage ON cvc.brambles_section_weights(startup_type, stage_group);
