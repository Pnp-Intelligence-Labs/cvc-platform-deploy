-- Migration 144: persist the PKCE code_verifier alongside the OAuth state nonce.
-- google_auth_oauthlib autogenerates a PKCE challenge at auth-url time; the
-- callback runs in a different request (often a different container), so the
-- verifier must survive in the DB or token exchange fails with invalid_grant.
ALTER TABLE cvc.drive_oauth_states ADD COLUMN IF NOT EXISTS code_verifier TEXT;
