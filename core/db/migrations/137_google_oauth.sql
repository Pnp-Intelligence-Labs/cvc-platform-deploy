-- Migration 137: Google OAuth support
-- Adds google_sub column to cvc.users for Google login linking.

ALTER TABLE cvc.users ADD COLUMN IF NOT EXISTS google_sub TEXT UNIQUE;
