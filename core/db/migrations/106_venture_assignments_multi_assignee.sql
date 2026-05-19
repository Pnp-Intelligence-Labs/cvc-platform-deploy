-- Migration 106: venture_assignments — multi-assignee support
-- Adds assigned_users TEXT[] to replace the single assigned_to TEXT column.
-- assigned_to kept in place (not dropped) for backward compat with any existing queries.

ALTER TABLE cvc.venture_assignments
  ADD COLUMN IF NOT EXISTS assigned_users TEXT[] NOT NULL DEFAULT '{}';

-- Backfill from existing single-assignee rows
UPDATE cvc.venture_assignments
  SET assigned_users = ARRAY[assigned_to]
  WHERE assigned_to IS NOT NULL AND cardinality(assigned_users) = 0;

-- GIN index for array containment queries (e.g. WHERE 'jerry' = ANY(assigned_users))
CREATE INDEX IF NOT EXISTS idx_va_assigned_users ON cvc.venture_assignments USING GIN(assigned_users);
