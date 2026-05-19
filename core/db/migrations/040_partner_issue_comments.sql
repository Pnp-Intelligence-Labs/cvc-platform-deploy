-- Migration 040: Partner issue comments / progress updates
-- Append-only log of comments per issue. Cascades on issue delete.

CREATE TABLE IF NOT EXISTS cvc.partner_issue_comments (
    id         SERIAL PRIMARY KEY,
    issue_id   INTEGER NOT NULL REFERENCES cvc.partner_issues(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT 'admin',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_issue_comments_issue_id ON cvc.partner_issue_comments(issue_id);

COMMENT ON TABLE cvc.partner_issue_comments IS
'Append-only progress updates / comments per partner issue. Cascades on issue delete.';
