-- alert_queries.sql — SQL alerting queries against cvc.auth_events + cvc.external_api_calls
-- (ISO 27001 A.8.16 / SOC 2 CC7.2)
--
-- Run these on a schedule (pg_cron, cron job, or monitoring agent).
-- Each query returns rows only when an alert condition is met.
-- Integrate with PagerDuty, Slack, or email via your monitoring stack.

-- ─── Auth Alerts ─────────────────────────────────────────────────────────────

-- 1. Brute-force: ≥5 login failures from same IP in 5 minutes
SELECT
    ip_address,
    COUNT(*)    AS failure_count,
    MIN(created_at) AS window_start,
    MAX(created_at) AS window_end
FROM cvc.auth_events
WHERE event_type = 'login_failure'
  AND success    = FALSE
  AND created_at >= NOW() - INTERVAL '5 minutes'
GROUP BY ip_address
HAVING COUNT(*) >= 5;

-- 2. Account locked out
SELECT user_id, username, attempt_count, locked_until, updated_at
FROM cvc.auth_lockouts
WHERE locked_until > NOW();

-- 3. Admin action: user deactivated in last 1 hour
SELECT user_id, username, detail, ip_address, created_at
FROM cvc.auth_events
WHERE event_type = 'user_deactivated'
  AND created_at >= NOW() - INTERVAL '1 hour';

-- 4. Admin action: new user created in last 1 hour
SELECT user_id, username, detail, ip_address, created_at
FROM cvc.auth_events
WHERE event_type = 'user_created'
  AND created_at >= NOW() - INTERVAL '1 hour';

-- 5. Password reset for another user (not self) in last 1 hour
SELECT user_id, username, detail, ip_address, created_at
FROM cvc.auth_events
WHERE event_type = 'password_reset'
  AND detail NOT LIKE 'self%'
  AND created_at >= NOW() - INTERVAL '1 hour';

-- 6. MFA disabled on any account in last 24 hours
SELECT user_id, username, detail, created_at
FROM cvc.auth_events
WHERE event_type = 'mfa_disabled'
  AND created_at >= NOW() - INTERVAL '24 hours';

-- 7. Repeated MFA failures (possible TOTP brute-force): ≥3 in 10 minutes per user
SELECT
    user_id,
    username,
    COUNT(*) AS fail_count,
    MIN(created_at) AS first_attempt
FROM cvc.auth_events
WHERE event_type = 'mfa_failure'
  AND success    = FALSE
  AND created_at >= NOW() - INTERVAL '10 minutes'
GROUP BY user_id, username
HAVING COUNT(*) >= 3;

-- 8. SSO login from previously unseen IP (first-time IP for that user)
SELECT e.user_id, e.username, e.ip_address, e.created_at
FROM cvc.auth_events e
WHERE e.event_type = 'sso_login'
  AND e.created_at >= NOW() - INTERVAL '1 hour'
  AND NOT EXISTS (
      SELECT 1 FROM cvc.auth_events prev
      WHERE prev.user_id = e.user_id
        AND prev.ip_address = e.ip_address
        AND prev.event_type IN ('login_success', 'sso_login')
        AND prev.created_at < e.created_at
  );

-- ─── API Error Rate ───────────────────────────────────────────────────────────

-- 9. High 5xx rate: more than 10 server errors in last 5 minutes
-- (requires structured request log table — add if you ingest access logs into Postgres)
-- Alternatively, use Loki/Grafana alert on log entries with "status":5xx.

-- ─── Third-Party API Alerts ───────────────────────────────────────────────────

-- 10. External API calls with unclassified data sent to LLM in last 24 hours
SELECT service, endpoint, user_id, data_class, pii_stripped, created_at
FROM cvc.external_api_calls
WHERE service     = 'openrouter'
  AND data_class  = 'restricted'
  AND pii_stripped = FALSE
  AND created_at  >= NOW() - INTERVAL '24 hours';

-- 11. Spike in external API usage: >100 calls to any service in last 1 hour
SELECT service, COUNT(*) AS call_count
FROM cvc.external_api_calls
WHERE created_at >= NOW() - INTERVAL '1 hour'
GROUP BY service
HAVING COUNT(*) > 100;

-- ─── Audit Summary (daily report) ────────────────────────────────────────────

-- 12. Daily auth event summary
SELECT
    event_type,
    COUNT(*) FILTER (WHERE success = TRUE)  AS successes,
    COUNT(*) FILTER (WHERE success = FALSE) AS failures,
    COUNT(DISTINCT user_id)                 AS distinct_users,
    COUNT(DISTINCT ip_address)              AS distinct_ips
FROM cvc.auth_events
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY event_type
ORDER BY event_type;
