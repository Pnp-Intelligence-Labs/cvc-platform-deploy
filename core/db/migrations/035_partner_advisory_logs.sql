-- Add factory_regions to partners table
ALTER TABLE cvc.partners 
ADD COLUMN IF NOT EXISTS factory_regions TEXT[];

-- Create partner_advisory_logs table
CREATE TABLE IF NOT EXISTS cvc.partner_advisory_logs (
    id SERIAL PRIMARY KEY,
    partner_id INT REFERENCES cvc.partners(id) ON DELETE CASCADE,
    log_type TEXT NOT NULL CHECK (log_type IN ('meeting', 'recommendation', 'outcome', 'action_item', 'proximity_signal')),
    body TEXT NOT NULL,
    company_id INT REFERENCES cvc.companies(id) ON DELETE SET NULL,
    meeting_date TIMESTAMPTZ,
    outcome TEXT,
    next_steps TEXT,
    source_url TEXT,
    created_by TEXT DEFAULT 'system',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster querying by partner and log type
CREATE INDEX IF NOT EXISTS idx_partner_advisory_logs_partner_type 
ON cvc.partner_advisory_logs(partner_id, log_type);
