-- Migration 066: Add dismissed_intel to partners for client-driven intel dismissal
ALTER TABLE cvc.partners
    ADD COLUMN IF NOT EXISTS dismissed_intel JSONB DEFAULT '{}'::jsonb;
