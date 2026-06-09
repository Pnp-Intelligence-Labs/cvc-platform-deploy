# ISO 27001 / SOC 2 Readiness Gaps
_Inferred from repository source code — not a formal audit. Date: 2026-06-09._

---

## What's Already In Place

| Control | Implementation | Standard reference |
|---|---|---|
| Auth event logging | `cvc.auth_events` table, every login/failure/logout | ISO A.8.15 / SOC CC7.2 |
| Account lockout | 5 failures → 30-min DB-backed lock, admin unlock endpoint | ISO A.8.5 / SOC CC6.1 |
| Login rate limiting | 5 attempts / 15 min per IP (`RateLimiter`) | ISO A.8.5 / SOC CC6.1 |
| Password policy | 12-char min, complexity, HIBP k-anon check, 5-password history | ISO A.9.4 / SOC CC6.1 |
| Dual-token JWT | 15-min access + 8-hour refresh, `token_invalidated_at` revocation | ISO A.8.5 / SOC CC6.1 |
| MFA / TOTP | TOTP enrolment + challenge flow, MFA secret Fernet-encrypted at rest | ISO A.8.5 / SOC CC6.1 |
| SSO (Keycloak) | Optional OIDC integration with role claim mapping | ISO A.8.5 |
| HTTP security headers | HSTS, CSP, X-Frame-Options DENY, nosniff, Referrer-Policy | ISO A.8.26 / SOC CC6.7 |
| Upload validation | Magic-byte MIME sniffing (`filetype`), allowlist, optional ClamAV | ISO A.8.12 |
| Parameterised SQL | All queries use `%s` placeholders — no string interpolation in queries | ISO A.8.6 |
| RBAC | GP / PSM / Ventures roles + per-user custom grants table | ISO A.8.3 / SOC CC6.3 |
| Request logging | Structured JSON per-request log with request-id correlation | ISO A.8.15 / SOC CC7.2 |
| CORS policy | Origins configurable via `ALLOWED_ORIGINS` env var | ISO A.8.20 |

---

## Gaps (prioritised)

### P1 — High: exploitable or blocks certification

**G1 · MFA not enforced globally**
`MFA_REQUIRED_ROLES` defaults to empty string — no user is required to use MFA unless the env var is set. A VC platform with deal terms and cap-table data should mandate MFA for all roles with write access.
_Ref: ISO A.8.5 / SOC CC6.1_

**G2 · No TLS configuration in repo**
HSTS header is sent, but there is no TLS termination config in `docker-compose.yml` or any reverse-proxy config. Deployers may run HTTP-only. Minimum: document HTTPS requirement; better: provide Caddy/nginx TLS config.
_Ref: ISO A.8.24 / SOC CC6.7_

**G3 · MinIO default secret key is `platform_local`**
`docker-compose.yml` line: `MINIO_ROOT_PASSWORD: ${MINIO_SECRET_KEY:-platform_local}`. Any deployment that omits `MINIO_SECRET_KEY` ships with a known credential for object storage.
_Ref: ISO A.8.24 / SOC CC6.1_

**G4 · No secret rotation mechanism**
`JWT_SECRET`, DB credentials, and API keys (Brave, Proxycurl, OpenRouter) are plain env vars with no rotation tooling, no Vault/KMS integration, and no documented rotation procedure.
_Ref: ISO A.8.24 / SOC CC6.3_

**G5 · No dependency / CVE scanning**
No Dependabot config, no Snyk/OWASP Dependency-Check, no GitHub Actions workflow. The `requirements.txt` / `pyproject.toml` lock over 30 transitive packages with no automated vulnerability alerting.
_Ref: ISO A.8.8 / SOC CC7.1_

---

### P2 — Medium: gaps that reduce audit confidence

**G6 · ClamAV disabled by default**
`CLAMAV_ENABLED` defaults to `false`. File uploads (PDFs, spreadsheets with macros) are accepted without virus scanning unless the deployer explicitly enables ClamAV. Supply-chain malware risk.
_Ref: ISO A.8.12 / SOC CC6.8_

**G7 · Audit log retention policy undefined**
`cvc.auth_events` and request logs are written but no retention period is configured, no purge job exists, and no policy document states how long logs must be kept (NIST recommends 90 days minimum; SOC 2 auditors expect ≥1 year for production).
_Ref: ISO A.8.15 / SOC CC7.2_

**G8 · No secrets scanning in CI**
No `.gitleaks.toml`, no `detect-secrets` pre-commit hook, no CI step to prevent accidental credential commits. The codebase currently has no hardcoded secrets, but there is no enforcement.
_Ref: ISO A.8.12 / SOC CC6.3_

**G9 · Rate limiting only on `/auth/login`**
Admin and data endpoints (`/companies`, `/portfolio`, `/admin/...`) have no rate limiting, enabling enumeration of company records or brute-forcing filter parameters.
_Ref: ISO A.8.20 / SOC CC6.1_

**G10 · Request logging may capture sensitive payloads**
`RequestLoggingMiddleware` logs every request. If request bodies (meeting notes, deal terms, passwords on password-reset endpoints) are logged, they appear in plaintext in log files. Verify `body` is excluded from logs on sensitive routes.
_Ref: ISO A.8.15 / SOC CC7.2_

**G11 · No formal access review workflow**
User deactivation endpoint exists (`DELETE /auth/users/{id}`), but there is no periodic access review process, no off-boarding checklist, and no tooling to detect stale accounts.
_Ref: ISO A.5.18 / SOC CC6.2_

---

### P3 — Low: process and documentation gaps

**G12 · No data classification scheme**
No labels on sensitive fields (deal valuations, cap-table data, partner contact info). Without classification, it is impossible to enforce differential access controls or GDPR data subject rights at a field level.
_Ref: ISO A.5.12 / SOC CC7.2_

**G13 · No incident response runbook**
`docs/compliance/monitoring/` exists but contains no incident response procedure, escalation path, or communication plan. SOC 2 CC7.3 requires a documented IR process.
_Ref: ISO A.5.24 / SOC CC7.3_

**G14 · No backup / disaster recovery documentation**
No backup scripts or DR runbook in the repo. `docker-compose.yml` mounts a `pgdata` volume but there is no automated backup job, RTO/RPO targets, or restore-test procedure.
_Ref: ISO A.8.13 / SOC A1.2_

**G15 · No network segmentation between services**
`docker-compose.yml` does not define explicit Docker networks. All containers share a default bridge network — DB port is reachable from the API container, MinIO, and any future plugin container without restriction.
_Ref: ISO A.8.20 / SOC CC6.6_

---

## Recommended Next Actions

1. **Immediate**: Set `MFA_REQUIRED_ROLES=GP,PSM,Ventures` in all deployments (G1).
2. **Immediate**: Rotate default MinIO secret key; add `MINIO_SECRET_KEY` to required env var checklist (G3).
3. **Short-term**: Add Dependabot or `uv lock --check` in CI; add `gitleaks` pre-commit hook (G5, G8).
4. **Short-term**: Document and enforce TLS via provided Caddy/nginx example config (G2).
5. **Medium-term**: Define log retention policy; add purge job for `cvc.auth_events` > 365 days (G7).
6. **Medium-term**: Enable ClamAV by default in docker-compose; document opt-out procedure (G6).
7. **Longer-term**: Integrate Vault or AWS Secrets Manager for secret rotation (G4).
8. **Longer-term**: Write incident response runbook and DR procedure in `docs/compliance/` (G13, G14).
