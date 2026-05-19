-- migration 125: editorial annotations on reports
-- SAFE: new table only — no existing tables touched

CREATE TABLE IF NOT EXISTS cvc.report_annotations (
    id              SERIAL PRIMARY KEY,
    report_id       INT NOT NULL,
    scope           TEXT NOT NULL DEFAULT 'inline',    -- 'inline' | 'document'
    selected_text   TEXT,                              -- the highlighted text span (inline only)
    comment         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open',      -- 'open' | 'addressed' | 'dismissed'
    proposed_rewrite TEXT,                             -- LLM-generated replacement text
    created_by      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    addressed_at    TIMESTAMPTZ,
    CONSTRAINT fk_ann_report FOREIGN KEY (report_id)
        REFERENCES cvc.trend_reports(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_report_annotations_report
    ON cvc.report_annotations(report_id, status);
