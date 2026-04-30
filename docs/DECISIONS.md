# Deployment Decisions Log

Tracks key decisions made during the CVC build that a new team needs to understand before deploying.

---

## 2026-04-28 — Initial Setup

### Platform Model
- **Self-hosted, not SaaS.** Each team runs their own instance on their own server.
- **Single tenant per deployment.** No shared DB between teams.
- **Reference implementation:** CVC on Dell R620 (basement server), Tailscale network.

### Role Model
Defined during CVC Phase 1 planning. Every deployment should start with these roles:

| Role | Access |
|------|--------|
| GP | Full access |
| Principal / Director | Full access except build config |
| Ventures | Companies, DD, deal flow, LP fund data |
| PSM | Assigned partners only. No LP fund data. |

### Data Isolation Rule — Visibility Tagging (NOT PostgreSQL RLS)

**Decision (finalized 2026-04-28): Use application-level visibility tagging. PostgreSQL RLS is NOT used and NOT planned.**

PSM partner terminal data (notes, documents, problems, advisory logs, issue comments) is isolated using two columns added to each of those tables:

| Column | Type | Values |
|--------|------|--------|
| `visibility` | TEXT | `team` (all authenticated staff) \| `psm_only` (creator PSM + GP/Principal/Director) \| `gp_only` |
| `assigned_psm` | TEXT | username of the owning PSM (NULL for team-visible rows) |

**Why tagging, not RLS:**
- Rules can change without DB migrations — just update the API filter helper
- Naturally extends to future visibility tiers (e.g. `ventures_only`, `board_only`)
- Simpler to audit and reason about than Postgres policy expressions

**How it is enforced:**
- API helper `_visibility_clause(user, alias)` in `api/routes/partners.py` builds the WHERE clause:
  - GP / Principal / Director: no filter — sees all rows
  - Ventures: `visibility = 'team'` only
  - PSM: `visibility = 'team'` OR (`visibility = 'psm_only'` AND `assigned_psm = their username`)
- PSM-created records are auto-tagged `visibility='psm_only'` + `assigned_psm=username` at the POST endpoint — no client involvement
- Every terminal data read is logged to `cvc.partner_terminal_access_log` (username, role, partner_id, action, timestamp)

**Tables covered (migration 084):** `partner_documents`, `partner_problems`, `partner_notes`, `partner_advisory_logs`, `partner_issue_comments`

**Do not implement RLS.** If someone suggests adding Postgres row-level security policies on these tables, that is the wrong direction.

### Auth (implemented 2026-04-28, Phase 1 complete)
- JWT only. Basic Auth is fully removed from the platform.
- `POST /auth/login` → 24hr HS256 token; payload carries `username`, `role`, `full_name`, `assigned_partner_ids`
- `GET /auth/me` — token introspection
- `POST /auth/refresh` — extend session
- Token stored in `localStorage['cvc_jwt']`; `AuthGuard.tsx` redirects to `/login` if absent
- FastAPI dependency `require_jwt` imported by any route that needs auth
- `cvc.users` table: `id`, `username`, `password_hash` (bcrypt), `role` FK, `full_name`, `email`, `assigned_partner_ids int[]`, `is_active`
- `cvc.roles` table: GP, Principal, Director, Ventures, PSM
- Default password at seed time: `cvc2026` — must be changed before handing to a real team

### What Each New Team Needs to Customize
1. Team name, logo
2. Users and role assignments
3. Partner assignments (PSM → partner mapping)
4. Fund details (fund name, size, vintage)
5. Sector focus (which sectors to track)
6. Corporate partners list
7. Investment thesis (used by enrichment workers)
8. API keys (OpenRouter, Brave Search, Proxycurl)

Everything else is standard platform behavior.
