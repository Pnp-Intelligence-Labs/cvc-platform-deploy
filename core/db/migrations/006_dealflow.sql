CREATE TABLE cvc.company_lifecycle (
    id SERIAL PRIMARY KEY,
    company_id INT REFERENCES cvc.companies(id) ON DELETE CASCADE,
    stage VARCHAR(50) NOT NULL CHECK (stage IN ('sourced', 'screening', 'diligence', 'ic_review', 'portfolio', 'exited', 'rejected')),
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'rejected')),
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    assigned_to INT REFERENCES cvc.users(id) ON DELETE SET NULL,
    source VARCHAR(100),
    entered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    exited_at TIMESTAMP,
    target_close_date DATE,
    investment_amount DECIMAL(15,2),
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_active_stage UNIQUE (company_id, stage, status)
);

CREATE INDEX idx_lifecycle_company ON cvc.company_lifecycle(company_id);
CREATE INDEX idx_lifecycle_stage ON cvc.company_lifecycle(stage);
CREATE INDEX idx_lifecycle_status ON cvc.company_lifecycle(status);
CREATE INDEX idx_lifecycle_assigned ON cvc.company_lifecycle(assigned_to);
CREATE INDEX idx_lifecycle_entered ON cvc.company_lifecycle(entered_at);

CREATE OR REPLACE FUNCTION cvc.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_company_lifecycle_updated_at 
    BEFORE UPDATE ON cvc.company_lifecycle 
    FOR EACH ROW 
    EXECUTE FUNCTION cvc.update_updated_at_column();