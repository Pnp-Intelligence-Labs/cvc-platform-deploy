# ISO 27001 / SOC 2 Readiness Gaps
_Inferred from repository source code — not a formal audit. Last updated: 2026-06-09._

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

## Closed Gaps

| Gap | Closed | How |
|-----|--------|-----|
| G1 · MFA not enforced globally | 2026-06-09 | `.env.example` default → `MFA_REQUIRED_ROLES=GP,PSM,Ventures`; `docker_entrypoint.sh` warns at startup if unset; `GOLIVE_CHECKLIST.md` updated |
| G2 · No TLS config in repo | 2026-06-09 | `infra/tls/Caddyfile.example` + `infra/tls/nginx.conf.example` added; `SETUP_GUIDE.md` + `GOLIVE_CHECKLIST.md` reference them |
| G3 · MinIO default secret `platform_local` | 2026-06-09 | `.env.example` default → `MINIO_SECRET_KEY=CHANGE_ME`; `install.sh` auto-generates 32-char hex key; `docker_entrypoint.sh` fatal-exits if default detected in production; `README.md` marks it Required |
| G5 · No dependency / CVE scanning | 2026-06-09 | `.github/dependabot.yml` (weekly pip + npm); `.github/workflows/security.yml` runs `uv lock --check` + `pip-audit` + `npm audit` on every PR |
| G8 · No secrets scanning in CI | 2026-06-09 | `.pre-commit-config.yaml` + `.gitleaks.toml` added; gitleaks runs on every commit with fixture allowlist |

---

## Open Gaps (prioritised)

### P1 — High: exploitable or blocks certification

**G4 · No secret rotation mechanism**
`JWT_SECRET`, DB credentials, and API keys (Brave, Proxycurl, OpenRouter) are plain env vars with no rotation tooling, no Vault/KMS integration, and no documented rotation procedure.
_Ref: ISO A.8.24 / SOC CC6.3_

---

### P2 — Medium: gaps that reduce audit confidence

**G6 · ClamAV disabled by default**
`CLAMAV_ENABLED` defaults to `false`. File uploads (PDFs, spreadsheets with macros) are accepted without virus scanning unless the deployer explicitly enables ClamAV. Supply-chain malware risk.
_Ref: ISO A.8.12 / SOC CC6.8_

**G7 · Audit log retention policy undefined**
`cvc.auth_events` and request logs are written but no retention period is configured, no purge job exists, and no policy document states how long logs must be kept (NIST recommends 90 days minimum; SOC 2 auditors expect ≥1 year for production).
_Ref: ISO A.8.15 / SOC CC7.2_

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

1. **Immediate**: Enable ClamAV by default in docker-compose; document opt-out (G6).
2. **Short-term**: Define log retention policy; add purge job for `cvc.auth_events` > 365 days (G7).
3. **Short-term**: Add rate limiting to admin + data endpoints (G9); audit `RequestLoggingMiddleware` for body capture on sensitive routes (G10).
4. **Medium-term**: Integrate Vault or AWS Secrets Manager for secret rotation (G4).
5. **Medium-term**: Build access review workflow + stale-account detection (G11).
6. **Longer-term**: Write incident response runbook and DR procedure in `docs/compliance/` (G13, G14).
7. **Longer-term**: Add explicit Docker network segmentation (G15); define data classification scheme (G12).
