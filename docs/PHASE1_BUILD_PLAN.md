# Platform Foundation — Multi-Phase Build Plan
**Created: 2026-04-28**
**Status: Approved — starting Phase 1**

---

## Objective

Transform CVC Intelligence from a single-user internal tool into a proper multi-user platform with role-based access, clean auth, and data isolation. Every change must leave the platform cleaner than it was found. No layering — replace and delete.

This plan also lays the architectural groundwork for replication to other teams.

---

## Phase 1 — Auth + Roles + Data Isolation
**Goal:** Replace Basic Auth with JWT, define roles in DB, enforce PSM data isolation at DB level.
**Constraint:** Additive — Basic Auth keeps working until every user is migrated. Zero downtime.

### 1.1 — Users + Roles Table (DB migration)
- New table: `cvc.users` — id, username, password_hash (bcrypt), role, full_name, email, assigned_partner_ids (int[]), is_active, created_at
- New table: `cvc.roles` — role name + description (GP, Principal, Director, Ventures, PSM)
- Seed: insert Nate as GP, define all 5 roles
- Migration: `083_users_roles.sql`
- **Clean up:** nothing to delete yet — additive step

### 1.2 — JWT Auth Endpoint
- New route: `POST /auth/login` — accepts username+password, returns JWT (24hr expiry)
- New route: `GET /auth/me` — returns current user + role from token
- New route: `POST /auth/refresh` — extends session
- JWT payload: `{ user_id, username, role, assigned_partner_ids }`
- Secret: `JWT_SECRET` env var on Dell
- **Clean up:** Remove `config/team_credentials.json` Basic Auth after all users migrated

### 1.3 — React Login Screen
- New page: `LoginPage.tsx` — username/password form, calls `/auth/login`, stores token in localStorage
- `AuthGuard.tsx` — updated to check JWT token instead of Basic Auth header
- `api/client.ts` — updated to send `Authorization: Bearer <token>` instead of Basic
- **Clean up:** Remove hardcoded `btoa('nate:cvc2026')` from client.ts and all fetch calls

### 1.4 — Row-Level Security (PSM Partner Isolation)
- Enable RLS on: `partner_documents`, `partner_problems`, `partner_notes`, `partner_advisory_logs`, `partner_issue_comments`
- Policy: GP/Principal/Director see all rows. PSM sees only rows where `partner_id` is in their `assigned_partner_ids`.
- API enforces partner assignment check on all `/partners/:id/terminal` routes
- **Clean up:** Remove any UI-level partner filtering that's now redundant with DB enforcement

### 1.5 — Role-Gated API Routes
- LP routes (`/lp/*`) — reject PSM role with 403
- Partner terminal routes — reject PSM if partner not in their assigned list
- Admin routes — GP/Principal/Director only
- **Clean up:** No existing gate logic to remove (nothing is gated today)

---

## Phase 2 — Personal UI + Role-Aware Navigation
**Goal:** Each user sees a UI shaped to their role. PSMs see their partners. Ventures see their pipeline.

### 2.1 — Role-Aware Navbar
- LP Portal tab: hidden for PSM role
- Admin tab: hidden for Ventures + PSM
- Partner Terminal: PSM only sees their assigned partners in the list

### 2.2 — PSM Partner Assignment UI
- Admin page: assign PSMs to partners (GP/Principal only)
- Stored in `cvc.users.assigned_partner_ids`

### 2.3 — Personal Dashboard
- Homepage shows role-specific widgets:
  - GP/Principal: full view (current)
  - Ventures: sourcing pipeline, DD queue, companies they've added
  - PSM: their assigned partners, open service requests, recent intros

### 2.4 — Activity Attribution
- `company_activity_log.changed_by` already stores username
- Surface per-user activity on homepage ("Your recent edits")

---

## Phase 3 — Production Readiness
**Goal:** Platform ready for migration to company server. Replication playbook complete.
**Note: Lives in `cvc-platform-deploy` repo — not in main codebase.**

### 3.1 — Tenant/Org Model
- Add `org_id` to all user-facing tables
- Enables clean data separation if ever needed for multi-team on shared infra

### 3.2 — Install Script
- `scripts/install.sh` — clones repo, sets up venv, creates DB, runs migrations, seeds roles, prompts for env vars
- `config/team.example.json` — template: team name, sectors, fund details, partner list, API keys

### 3.3 — Docker / Clean Deployment Spec
- `docker-compose.yml` — API + PostgreSQL + MinIO
- Removes dependency on manual server setup

### 3.4 — MinIO Storage Migration
- Move `partner_documents` bytea blobs → MinIO on `/mnt/storage`
- Move DD workdir → MinIO
- Remove React build assets from git → build pipeline

---

## Cleanup Rules (enforced throughout all phases)

1. **Replace, don't layer.** Old auth deleted when new auth is proven.
2. **Mark temporaries explicitly.** `# TEMP: remove after JWT migration` — never left ambiguous.
3. **No dead functions.** If a function is no longer called after a change, delete it.
4. **Migrations are permanent.** No reversing a migration by editing it. Add a new one.
5. **Test before closing each task.** Platform must be healthier after the task than before.

---

## Task Queue Reference

All Phase 1 tasks are in `cvc.build_tasks` with `task_type='foundation'` and `priority='high'`.
Filter on dashboard: Task Queue → filter by type=foundation.
