-- Migration 103: Sales stage history audit table + trigger
-- Tracks every stage change on sales_targets for leaderboard weekly_delta calculations.

CREATE TABLE IF NOT EXISTS cvc.sales_stage_history (
    id           serial PRIMARY KEY,
    target_id    int NOT NULL REFERENCES cvc.sales_targets(id) ON DELETE CASCADE,
    company_name text,
    assigned_to  text,
    old_stage    text,
    new_stage    text,
    changed_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ssh_target_id   ON cvc.sales_stage_history(target_id);
CREATE INDEX IF NOT EXISTS idx_ssh_assigned_to ON cvc.sales_stage_history(assigned_to);
CREATE INDEX IF NOT EXISTS idx_ssh_changed_at  ON cvc.sales_stage_history(changed_at);

-- Auto-log every stage change
CREATE OR REPLACE FUNCTION cvc.log_stage_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.stage IS DISTINCT FROM NEW.stage THEN
        INSERT INTO cvc.sales_stage_history
            (target_id, company_name, assigned_to, old_stage, new_stage, changed_at)
        VALUES
            (NEW.id, NEW.company_name, NEW.assigned_to, OLD.stage, NEW.stage, now());
        -- Keep stage_changed_at in sync
        NEW.stage_changed_at := now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sales_stage_change_trigger ON cvc.sales_targets;
CREATE TRIGGER sales_stage_change_trigger
    BEFORE UPDATE ON cvc.sales_targets
    FOR EACH ROW EXECUTE FUNCTION cvc.log_stage_change();
