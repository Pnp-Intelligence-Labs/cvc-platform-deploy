# CVC Intelligence Platform — Product Vision
**Last updated: 2026-04-28**

---

## What This Is

A unified operating system for investment teams. Built by CVC (Claw Venture Capital) as the first instance. Designed from the ground up to be repeatable — another team should be able to stand up their own version with a clean onboarding process.

CVC's deployment on the Dell R620 (basement server) is the **sandbox and proof of concept**. The long-term destination is a company-hosted server once the platform is production-ready.

---

## Who Uses It

**Internal team only.** No external access for partners or LPs.

### Roles

| Role | Who | Access Level |
|------|-----|-------------|
| GP | Nate | Full access to everything |
| Principal / Director | Senior team | Full access except new build configuration |
| Ventures | Analysts / Associates | Sourcing, companies DB, DD pipeline, deal flow, LP fund data |
| PSM | Partner Success Managers | Assigned partners only, partner terminal is private. No LP fund data. |

### Permission Rules

1. **LP / Fund data** — GP, Principal, Director, Ventures only. PSMs cannot access.
2. **PSM partner terminals** — private to the assigned PSM. GP, Principal, Director can view. Other PSMs cannot.
3. **Partner terminal data is isolated at the DB level** — not just a UI filter. Each PSM's sensitive partner data (notes, documents, service requests) is row-level secured so no application bug can leak it cross-PSM.

---

## Current State (as of 2026-04-28)

### Infrastructure
- **Server:** Dell R620 (100.83.104.117) — 24 cores, 96GB RAM
- **Storage:** 238.5GB SSD (OS + DB + app) + **1TB new drive at /mnt/storage** (added 2026-04-28)
- **Dev machine:** Refinery/WSL (100.114.250.70) — RTX 3090, primary dev + briefing enrichment
- **DB:** PostgreSQL `cvc_db`, ~1,700+ companies, 47 tables, 807MB data

### What's Live

**Portfolio Management**
- Fund I (29 companies) + Family Office (56 companies) — unified profiles, separate investment positions per vehicle
- LP reporting tab: NAV history, TVPI chart, annual reports, fund metrics
- Capital deployed: Fund I $17.7M + Family Office $5.1M = $22.8M total
- Term sheets with full investment data: check size, valuation, round type, co-investors, MOIC, write-offs

**Company Intelligence**
- 1,700+ companies with enriched profiles: 4D classification, scoring, funding rounds, case studies, news
- 6-step enrichment pipeline: Founder Research → 4D → Funding → Case Studies → Industrial → Score Refresh
- Commercial deployments tracker (stealth mode for sensitive customers)
- Partner introductions history per company
- Intel upload + AI suggestion workflow (accept/reject/edit)

**Sourcing**
- Advanced search with sector, stage, geography, signal score, funding filters
- Signal scoring across multiple dimensions
- Shortlists — curated company lists

**Due Diligence**
- Full DD pipeline: 8 specialist agents → IC Memo PDF + Appendix + Scorecard XLSX
- Analyst review workflow with feedback loop (scores improve over time)
- Brambles Strategic Fund pipeline — independent advisory product (63 companies)

**Partner CRM**
- Partner list, detail panels, documents, contacts
- Partner Terminal: Market Discovery, Active Pilots, Risk Assessment, Stack View, Problem Board
- Document intelligence — LLM-extracted action items, themes, people
- Partner signal tracking (entity mentions in market content)
- Startup introductions ledger

**Market Intelligence**
- Weekly briefing (Sunday) — podcast synthesis, news, partner signals, topic tabs
- Content collection pipeline: 19 YouTube channels + RSS feeds
- Entity resolution → partner signal matching via pgvector
- Industrial readiness matrix (robotics/supply chain/manufacturing)

**Operations**
- Admin page: Batch enrichment, Brave Search, Task Queue, Staff Feedback, Signal Queue
- Worker scheduler with DB-gated cron jobs (enable/disable from UI)
- OpenRouter + Brave Search usage tracking
- Chrome extension for source verification during human review

---

## The Major Build Ahead — Platform Foundation

Before new features are added, the platform needs a proper foundation. This is the work that makes it production-grade and replicable.

### Phase 1 — Auth + Roles + Data Isolation (next sprint)

**Why now:** Shared Basic Auth had no expiry, roles, or audit trail. JWT auth should remain the default before the team grows or any migration happens.

**What gets built:**
1. **Users + roles table in DB** — GP, Principal, Director, Ventures, PSM defined as first-class concepts
2. **JWT authentication** — users log in once, get a token, token carries their role. Login screen replaces hardcoded Basic Auth.
3. **Row-level security** on partner terminal tables — DB enforces PSM data isolation, not just the app
4. **Remove all hardcoded paths** — `nathan11` user paths, hardcoded IPs as defaults

**What doesn't change:** All existing pages and features work identically. The only visible change to the team is a login screen.

### Phase 2 — Personal UI + Role-Aware Navigation

**What gets built:**
1. Role-aware navbar — PSMs don't see LP data, ventures don't see partner terminals they're not assigned to
2. PSM partner assignment — each PSM is linked to their partners in DB
3. Personal dashboards — homepage shows your work, not a global feed

### Phase 3 — Production Readiness (private, separate repo)

**What gets built:**
1. Tenant/org model — org_id on all tables so the schema supports multiple teams
2. Install script + onboarding config — any team can stand this up in under an hour
3. Docker or clean deployment spec
4. Documentation for replication

*This phase lives in a separate private repo. Not visible in this codebase.*

---

## Storage Architecture

### Current
- **PostgreSQL** — companies, all enrichment data, partner CRM, fund data
- **`partner_documents`** — file blobs stored as `bytea` in DB (672MB, growing)
- **`content_items.raw_text`** — podcast transcripts in DB (large text)
- **`workers/dd/workdir/`** — DD artifacts on disk inside repo

### Planned Migration
- **MinIO on /mnt/storage** — move file blobs off PostgreSQL onto the 1TB drive
  - `partner_documents` file data → MinIO
  - DD workdir artifacts → MinIO (with DB index)
  - React build output → served from MinIO or build pipeline (not committed to git)
- **PostgreSQL** stays for structured data only — no large blobs

---

## Deployment (Current)

```
Developer (Refinery) → git push origin main
  → ssh Dell: bash ~/scripts/update_api.sh
    → git pull origin main
    → 12 API health checks
    → systemd restart
```

**Known gaps:**
- No CI/CD
- React build assets committed to git (should be build-time artifact)
- No rollback beyond `git revert`
- Workers started manually or by cron — no supervisor per worker

---

## What This Is Not (and Will Not Become)

- A mobile app — desktop browser only
- A public-facing product — internal team only
- A real-time platform — pipelines run on schedule
- A Notion/Airtable replacement — Postgres is the source of truth, not duplicated elsewhere
- Multi-tenant SaaS — each team runs their own instance (self-hosted replication model)

---

## Related Docs

- `docs/ARCHITECTURE_AUDIT_2026_04_28.md` — complete system snapshot, pre-migration reference
- `docs/DATABASE_SCHEMA.md` — DB table reference
- `docs/INFRASTRUCTURE.md` — server and network topology
- `CLAUDE.md` — build rules, repo map, architectural constraints
