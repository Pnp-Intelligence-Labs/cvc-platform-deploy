-- Migration 060: Add 'case_study' to intel_suggestions suggestion_type constraint
-- Brave-sourced case studies now queue here for human review before writing to companies.case_studies

ALTER TABLE cvc.intel_suggestions
  DROP CONSTRAINT IF EXISTS intel_suggestions_suggestion_type_check;

ALTER TABLE cvc.intel_suggestions
  ADD CONSTRAINT intel_suggestions_suggestion_type_check
  CHECK (suggestion_type = ANY (ARRAY[
    'new_funding_round'::text,
    'field_update'::text,
    'new_investor'::text,
    'case_study'::text
  ]));
