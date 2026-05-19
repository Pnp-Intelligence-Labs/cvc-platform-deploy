-- Migration 129: DB-level audit trigger for direct writes to cvc.companies
--
-- Any INSERT/UPDATE/DELETE that does NOT come through the application layer
-- (API or workers, which set app.audit_source = 'app') will be logged to
-- company_activity_log with change_source = 'db_direct'.
--
-- This catches: psql commands, bulk imports via \copy, one-off scripts,
-- and any future data dumps that bypass the API.

CREATE OR REPLACE FUNCTION cvc.audit_companies_direct()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    _src text;
BEGIN
    -- Skip if write came through the application (API or workers)
    _src := current_setting('app.audit_source', true);
    IF _src = 'app' THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF TG_OP = 'INSERT' THEN
        INSERT INTO cvc.company_activity_log
            (company_id, changed_by, changed_at, field_name, old_value, new_value, change_source)
        VALUES
            (NEW.id, current_user, NOW(), '_row_inserted', NULL, NEW.name, 'db_direct');

    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.name IS DISTINCT FROM NEW.name THEN
            INSERT INTO cvc.company_activity_log (company_id, changed_by, changed_at, field_name, old_value, new_value, change_source)
            VALUES (NEW.id, current_user, NOW(), 'name', OLD.name, NEW.name, 'db_direct');
        END IF;
        IF OLD.sector IS DISTINCT FROM NEW.sector THEN
            INSERT INTO cvc.company_activity_log (company_id, changed_by, changed_at, field_name, old_value, new_value, change_source)
            VALUES (NEW.id, current_user, NOW(), 'sector', OLD.sector, NEW.sector, 'db_direct');
        END IF;
        IF OLD.stage IS DISTINCT FROM NEW.stage THEN
            INSERT INTO cvc.company_activity_log (company_id, changed_by, changed_at, field_name, old_value, new_value, change_source)
            VALUES (NEW.id, current_user, NOW(), 'stage', OLD.stage, NEW.stage, 'db_direct');
        END IF;
        IF OLD.is_portfolio IS DISTINCT FROM NEW.is_portfolio THEN
            INSERT INTO cvc.company_activity_log (company_id, changed_by, changed_at, field_name, old_value, new_value, change_source)
            VALUES (NEW.id, current_user, NOW(), 'is_portfolio', OLD.is_portfolio::text, NEW.is_portfolio::text, 'db_direct');
        END IF;
        IF OLD.enrichment_status IS DISTINCT FROM NEW.enrichment_status THEN
            INSERT INTO cvc.company_activity_log (company_id, changed_by, changed_at, field_name, old_value, new_value, change_source)
            VALUES (NEW.id, current_user, NOW(), 'enrichment_status', OLD.enrichment_status, NEW.enrichment_status, 'db_direct');
        END IF;
        IF OLD.website IS DISTINCT FROM NEW.website THEN
            INSERT INTO cvc.company_activity_log (company_id, changed_by, changed_at, field_name, old_value, new_value, change_source)
            VALUES (NEW.id, current_user, NOW(), 'website', OLD.website, NEW.website, 'db_direct');
        END IF;
        IF OLD.description IS DISTINCT FROM NEW.description THEN
            INSERT INTO cvc.company_activity_log (company_id, changed_by, changed_at, field_name, old_value, new_value, change_source)
            VALUES (NEW.id, current_user, NOW(), 'description',
                    LEFT(OLD.description, 200), LEFT(NEW.description, 200), 'db_direct');
        END IF;
        IF OLD.score_composite IS DISTINCT FROM NEW.score_composite THEN
            INSERT INTO cvc.company_activity_log (company_id, changed_by, changed_at, field_name, old_value, new_value, change_source)
            VALUES (NEW.id, current_user, NOW(), 'score_composite',
                    OLD.score_composite::text, NEW.score_composite::text, 'db_direct');
        END IF;
        IF OLD.country IS DISTINCT FROM NEW.country THEN
            INSERT INTO cvc.company_activity_log (company_id, changed_by, changed_at, field_name, old_value, new_value, change_source)
            VALUES (NEW.id, current_user, NOW(), 'country', OLD.country, NEW.country, 'db_direct');
        END IF;
        IF OLD.one_liner IS DISTINCT FROM NEW.one_liner THEN
            INSERT INTO cvc.company_activity_log (company_id, changed_by, changed_at, field_name, old_value, new_value, change_source)
            VALUES (NEW.id, current_user, NOW(), 'one_liner', OLD.one_liner, NEW.one_liner, 'db_direct');
        END IF;

    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO cvc.company_activity_log
            (company_id, changed_by, changed_at, field_name, old_value, new_value, change_source)
        VALUES
            (OLD.id, current_user, NOW(), '_row_deleted', OLD.name, NULL, 'db_direct');
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$;

-- Drop if exists (safe re-run)
DROP TRIGGER IF EXISTS trg_audit_companies_direct ON cvc.companies;

CREATE TRIGGER trg_audit_companies_direct
    AFTER INSERT OR UPDATE OR DELETE ON cvc.companies
    FOR EACH ROW EXECUTE FUNCTION cvc.audit_companies_direct();
