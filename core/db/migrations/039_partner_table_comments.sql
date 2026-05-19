-- Migration 039: Add table and column comments to partner data group
-- Documents the isolation architecture directly in the DB.
-- All partner tables are scoped to cvc.partners via FK ON DELETE CASCADE.
-- No partner table joins to cvc.companies or any trend/content table.

COMMENT ON TABLE cvc.partners IS
'Core partner registry. One row per corporate partner. All partner sub-tables FK here with ON DELETE CASCADE.';

COMMENT ON TABLE cvc.partner_documents IS
'Uploaded documents for a partner. Binary files are NOT stored — only extracted text (raw_text). Each row is scoped to exactly one partner_id. No document is accessible across partners or from startup/company data. Full-text search via to_tsvector on raw_text.';

COMMENT ON COLUMN cvc.partner_documents.partner_id IS
'FK → cvc.partners.id ON DELETE CASCADE. Required. Isolates documents to a single partner.';

COMMENT ON COLUMN cvc.partner_documents.raw_text IS
'Extracted text only — binary PDF/DOCX bytes are not persisted. Extraction: pypdf2 for PDF, python-docx for DOCX.';

COMMENT ON COLUMN cvc.partner_documents.source_label IS
'User-supplied label at upload time, e.g. "Q1 2026 Overview". Optional.';

COMMENT ON TABLE cvc.partner_notes IS
'Append-only notes log per partner. Notes are never edited or deleted through the API. Scoped by partner_id.';

COMMENT ON TABLE cvc.partner_contacts IS
'One-to-many contacts per partner. Supersedes the legacy contact_name/contact_email columns on cvc.partners. Only one contact per partner should have is_primary = TRUE.';

COMMENT ON TABLE cvc.partner_contracts IS
'Contract metadata ingested from PDFs via the contract ingestion script. The PDF binary is NOT stored in the DB — file_link holds the absolute filesystem path on the Dell server. Served to the UI via FastAPI FileResponse. status_color and days_until_expiry are computed at query time from expiry_date.';

COMMENT ON COLUMN cvc.partner_contracts.file_link IS
'Absolute path to the contract PDF on the Dell server filesystem. Served via GET /partners/{id}/contract/file (FastAPI FileResponse). Binary is not in the DB.';

COMMENT ON COLUMN cvc.partner_contracts.partner_id IS
'FK → cvc.partners.id ON DELETE CASCADE. Added in migration 038.';

COMMENT ON TABLE cvc.partner_service_usage IS
'Tracks service delivery against contract entitlements by partner and year. quantity_included = allotted per contract (NULL means unlimited). quantity_used = delivered to date. Populated by import_startup_intros_deliverables.py and manual UI entry.';
