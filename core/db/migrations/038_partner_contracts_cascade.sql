-- Migration 038: Add ON DELETE CASCADE to partner_contracts foreign key
-- Without this, deleting a partner with contracts fails with a FK violation.

ALTER TABLE cvc.partner_contracts
    DROP CONSTRAINT IF EXISTS partner_contracts_partner_id_fkey;

ALTER TABLE cvc.partner_contracts
    ADD CONSTRAINT partner_contracts_partner_id_fkey
    FOREIGN KEY (partner_id) REFERENCES cvc.partners(id) ON DELETE CASCADE;
