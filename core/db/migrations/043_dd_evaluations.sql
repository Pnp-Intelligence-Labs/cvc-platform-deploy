-- Migration 043: Create dd_evaluations table for Due Diligence Phase 1
-- Run via: psql -d cvc -f core/db/migrations/043_dd_evaluations.sql
-- Or automatically via ensure_table_exists() in workers/dd/db_logger.py

CREATE TABLE IF NOT EXISTS cvc.dd_evaluations (
    id SERIAL PRIMARY KEY,
    company_id INTEGER REFERENCES cvc.companies(id) ON DELETE CASCADE,
    evaluation_type VARCHAR(50) DEFAULT 'automated',
    status VARCHAR(20) DEFAULT 'pending',
    score_overall NUMERIC(5,2),
    score_market NUMERIC(5,2),
    score_product NUMERIC(5,2),
    score_team NUMERIC(5,2),
    score_financial NUMERIC(5,2),
    score_strategic_fit NUMERIC(5,2),
    evaluator_notes TEXT,
    raw_data JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dd_evaluations_company_id 
ON cvc.dd_evaluations(company_id);

CREATE INDEX IF NOT EXISTS idx_dd_evaluations_status 
ON cvc.dd_evaluations(status);

CREATE INDEX IF NOT EXISTS idx_dd_evaluations_created_at 
ON cvc.dd_evaluations(created_at DESC);
