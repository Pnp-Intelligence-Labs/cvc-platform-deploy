CREATE TABLE cvc.batch_jobs (
    id SERIAL PRIMARY KEY,
    job_type VARCHAR(50) NOT NULL,
    target_type VARCHAR(50) NOT NULL,
    sector VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_by VARCHAR(100),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    results_summary JSONB DEFAULT '{}',
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_batch_jobs_created_at ON cvc.batch_jobs(created_at DESC);
CREATE INDEX idx_batch_jobs_status ON cvc.batch_jobs(status);
