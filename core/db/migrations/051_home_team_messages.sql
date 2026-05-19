CREATE TABLE IF NOT EXISTS cvc.home_team_messages (
    id         BIGSERIAL PRIMARY KEY,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    posted_by  TEXT NOT NULL DEFAULT 'admin',
    pinned     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
