-- 048_simplify_pipeline_stages.sql
-- Collapse 6 pipeline stages down to 4: discovered, due_diligence, invested, passed.
-- Table is empty so no data migration needed.

ALTER TABLE cvc.company_lifecycle
    DROP CONSTRAINT company_lifecycle_status_check;

ALTER TABLE cvc.company_lifecycle
    ADD CONSTRAINT company_lifecycle_status_check
    CHECK (status = ANY (ARRAY[
        'discovered'::text,
        'due_diligence'::text,
        'invested'::text,
        'passed'::text
    ]));

-- Keep default as discovered
ALTER TABLE cvc.company_lifecycle
    ALTER COLUMN status SET DEFAULT 'discovered';
