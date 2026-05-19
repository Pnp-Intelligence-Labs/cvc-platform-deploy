-- Migration 007: Add retry_count and parent_task_id to cvc.build_tasks
-- Supports automatic failure retry logic in task_deployer.py

ALTER TABLE cvc.build_tasks
    ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS parent_task_id INTEGER REFERENCES cvc.build_tasks(task_id);

COMMENT ON COLUMN cvc.build_tasks.retry_count IS 'Number of times this task lineage has been retried. Max 2 before escalation to Nate.';
COMMENT ON COLUMN cvc.build_tasks.parent_task_id IS 'References the original task this is a retry of. NULL for original tasks.';
