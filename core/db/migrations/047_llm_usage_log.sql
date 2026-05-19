-- 047_llm_usage_log.sql
-- Track every OpenRouter LLM call: activity, model, tokens, cost.
-- Used by the homepage LLM Cost widget.

CREATE TABLE IF NOT EXISTS cvc.llm_usage_log (
    id               SERIAL PRIMARY KEY,
    activity         TEXT         NOT NULL DEFAULT 'unknown',
    model            TEXT         NOT NULL,
    prompt_tokens    INTEGER      NOT NULL DEFAULT 0,
    completion_tokens INTEGER     NOT NULL DEFAULT 0,
    cost             NUMERIC(10, 6) NOT NULL DEFAULT 0,
    called_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS llm_usage_log_called_at_idx ON cvc.llm_usage_log (called_at DESC);
CREATE INDEX IF NOT EXISTS llm_usage_log_activity_idx  ON cvc.llm_usage_log (activity);
