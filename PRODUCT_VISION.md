# CVC Intelligence Platform — Product Vision
**Last updated: 2026-04-07**

---

## What We Are Building

A unified web platform for the CVC ventures team and Fortune 500 corporate partners. The platform consolidates sourcing, portfolio management, deal flow, partner CRM, LP reporting, and industrial market intelligence into a single authenticated application backed by our enriched company database.

---

## Infrastructure

| Machine | Role | IP |
|---|---|---|
| Dell R620 (basement) | Everything — API (port 8001), PostgreSQL, all workers, BigBossHog, Big Claw, Sharp Claw | 100.83.104.117 |
| Refinery/WSL | Primary dev machine — Claude Code, Ollama (RTX 3090), git origin | 100.114.250.70 |
| Lenovo (Whip Claw) | Memory / monitoring | 100.74.101.77 |

**Database:** PostgreSQL `cvc_db` on Dell, schema `cvc`, ~1,700+ companies.

**Droplet (100.95.2.44) is decommissioned.** All references to it in old docs are stale.

---

## What Is Built (Current State)

### Platform Architecture
- **FastAPI** backend, port 8001, JWT auth
- **React SPA** (Vite + Tailwind + Recharts), source in `designs/figma-dashboard/`, built to `api/static/app/`, served at `/app`
- **React Router** handles all client-side routing under `/app`
- Route prefix rule: ALL prefixes set in `main.py include_router(prefix=...)` — never in `APIRouter()`

### Routes (React SPA at `/app/*`)

| Path | Page | Status |
|---|---|---|
| `/` | Portfolio Homepage | Live |
| `/companies` | Company Search & Directory | Live |
| `/company/:id` | Company Profile | Live |
| `/sourcing` | Sourcing View | Live |
| `/pipeline` | Deal Flow Pipeline | Live |
| `/partners` | Partner Management (CRM) | Live |
| `/partners/:id/terminal` | Partner Advisory Terminal | Live |
| `/intelligence` | Intelligence Feed | Live |
| `/industrial` | Industrial Matrix | Live |
| `/lp-portal` | LP Portal | Live |
| `/build-queue` | Build Task Queue | Live |

### API Endpoints

| Prefix | File | Key Endpoints |
|---|---|---|
| `/companies` | `routes/companies.py` | GET /, GET /sectors, GET /{id} |
| `/sourcing` | `routes/sourcing.py` | GET / (scored, filterable) |
| `/portfolio` | `routes/portfolio.py` | GET / (portfolio only), GET /stats |
| `/dealflow` | `routes/dealflow.py` | GET /, POST /intake, POST /upload/{id} |
| `/partners` | `routes/partners.py` | Full CRUD + compatibility engine + doc ingestion + advisory logs |
| `/lp` | `routes/lp.py` | GET /overview, /sectors, /signals |
| `/intelligence` | `routes/intelligence.py` | GET / |
| `/industrial` | `routes/industrial.py` | GET /matrix |
| `/tasks` | `routes/tasks.py` | GET /, POST /{id}/approve |
| `/trends` | `routes/trends.py` | GET / |
| `/shortlists` | `routes/shortlists.py` | GET /, POST / |

---

## Features Detail

### 1. Portfolio Homepage (`/`)
- KPI cards: company count, capital deployed, avg age, total partner intros
- Sector pie chart, stage distribution bar chart
- Top by Partner Intros list, Recent Introductions list
- Portfolio company tiles grid (all 67 portfolio companies, links to profiles)

### 2. Company Search & Profiles (`/companies`, `/company/:id`)
- Search by name, filter by sector (dynamic from DB), stage
- Signal score ring, funding, location
- Profile: all enriched fields, 4D classification, individual score cards, LinkedIn
- Scoring: `score_composite`, `score_irs`, `score_commercial`, `score_technical`, `score_market_timing`, `score_partner_fit`, `score_capital_eff`
- 4D: `env_4d`, `func_4d`, `stack_4d`, `biz_model_4d`

### 3. Sourcing View (`/sourcing`)
- Full scored company search with signal score
- Links to company profiles

### 4. Deal Flow Pipeline (`/pipeline`)
- Kanban-style pipeline with status tracking
- File upload for datarooms

### 5. Partner Management (`/partners`)
- Partner list with search filter
- Detail panel: Overview, Documents, Notes tabs
- Document upload (PDF/DOCX/TXT) with inline text extraction (pdfplumber/python-docx)
- Notes (quick-add field always visible at bottom)
- Full-text search across all partner documents
- Delete partner (with confirmation)
- "Open Terminal" button per partner → navigates to Advisory Terminal

### 6. Partner Advisory Terminal (`/partners/:id/terminal`) ← NEW
**Institutional dark-mode UI for Fortune 500 RM workflow.**

**Partner DNA Sidebar:**
- Protocol selector (14 known industrial protocols)
- Cloud platform, hardware vendors, factory regions
- Adoption speed (Fast/Medium/Slow → sets MRL target band)
- Save → recalculates Compatibility Index across full DB

**Compatibility Index Engine (`GET /partners/{id}/compatibility`):**
- `CompatibilityIndex (0-100) = ProtocolScore (0-50) + MRLScore (0-50)`
- Protocol Score: weighted intersection of partner vs startup protocols
- MRL Score: `industrial_readiness_score` vs ideal band by scaling speed
- Labels: Tier 1 (≥80), Tier 2 (60-79), Watchlist (40-59), Low Fit (<40)
- Badge string: e.g. `"87% Match for BMW North America"`

**Three tabs:**
- **Market Discovery** — compatibility-ranked startup grid with Protocol Bridge per card
- **Active Pilots** — `partner_matches` with expandable protocol bridge, advisory log per company
- **Risk Assessment** — sovereignty tier table grouped by country, concentration analysis

**Advisory Ledger** — structured log entries (meeting/recommendation/outcome/action_item) with company link, date, outcome, next steps.

### 7. Industrial Matrix (`/industrial`)
- Scatter matrix: readiness vs friction vs sovereignty
- Sectors: Robotics, Manufacturing, Supply Chain, Industrial Automation, Physical AI
- Protocol support, deployment signal, verified certs
- Composite score = (readiness × 0.4) + (sovereignty × 0.3) + ((10−friction) × 0.3)

### 8. LP Portal (`/lp-portal`)
- Fund-level metrics from real DB: net TVPI, portfolio companies, sector allocation
- Signals feed

### 9. Intelligence Feed (`/intelligence`)
- Weekly intelligence content

### 10. Build Queue (`/build-queue`)
- Live view of `cvc.build_tasks` — pending, in_progress, complete, deployed

---

## Database Schema (Key Tables)

| Table | Purpose |
|---|---|
| `cvc.companies` | ~1,700+ companies. Core enriched profiles. |
| `cvc.funding_rounds` | Funding events by company |
| `cvc.company_lifecycle` | Portfolio status tracking |
| `cvc.partners` | Corporate partners (F500 CRM) |
| `cvc.partner_matches` | Startup ↔ partner match records with status |
| `cvc.partner_documents` | Uploaded docs per partner (PDF/DOCX/TXT, extracted text, FTS index) |
| `cvc.partner_notes` | Freeform notes per partner |
| `cvc.partner_advisory_logs` | Structured advisory log (meeting/recommendation/outcome/proximity_signal) |
| `cvc.build_tasks` | Task queue for BigBossHog/Big Claw |
| `cvc.dd_evaluations` | DD pipeline outputs |
| `cvc.agent_memory` | Agent memory logs |

### Key `cvc.companies` Columns
- Sectors are Title Case: `Robotics`, `Manufacturing`, `Supply Chain`, `Industrial Automation`, `Physical AI`
- `is_portfolio` (bool) — 67 portfolio companies
- `score_composite`, `score_irs`, `score_sri`, `score_tdf`, `score_commercial`, `score_technical`, `score_market_timing`, `score_partner_fit`, `score_capital_eff`
- `env_4d`, `func_4d`, `stack_4d`, `biz_model_4d` — 4D classification
- `industrial_readiness_score`, `sovereignty_score`, `protocol_support`, `deployment_signal_level`, `verified_certs`, `intel_sources`
- `investors`, `tags` — `text[]`, NOT jsonb

### Key `cvc.partners` Columns (updated 2026-04-07)
- `current_protocols text[]` — partner legacy protocol stack
- `cloud_platform text` — Azure, AWS, GCP, On-Prem, Hybrid
- `hardware_vendors text[]` — e.g. Fanuc, Siemens, Rockwell
- `factory_regions text[]` — key geographies for proximity matching
- `scaling_speed text` — fast | medium | slow (drives MRL band)

---

## Active Workers (Dell Cron Schedule)

| Time (UTC) | Job |
|---|---|
| 2:00 AM | `enrich_worker.py` — Phase 1 company enrichment |
| 2:30 AM | `enrich_phase2.py` — Phase 2 enrichment |
| 3:00 AM | `score_refresh.py` — scoring refresh |
| 4:00 AM | `backup_db.sh` — DB backup |
| 4:30 AM | `briefing/enrichment_worker.py` — content enrichment |
| 5:00 AM Sunday | `briefing/weekly_briefing.py` |
| 6:00 AM Sunday | `scrapers/weekly_signals.py` |
| Every 5 min | API watchdog |

Industrial enrichment (`workers/enrichment/enrich_industrial.py`) runs on demand. Targets: Robotics, Manufacturing, Supply Chain, Industrial Automation, Physical AI. Uses OpenRouter LLM to score `industrial_readiness_score`, `sovereignty_score`, `protocol_support`, `intel_sources`.

---

## Outstanding Build Tasks

**Last audited: 2026-04-07**

| Task | Description | True Status | Notes |
|---|---|---|---|
| 69 | IntelligenceSector React page (per-sector detail: narrative, funding chart, signals) | NOT BUILT | No page file or route exists. IntelligenceFeed.tsx is a sector list, not a per-sector detail. |
| 71 | Trends dashboard React page | NOT BUILT | No Trends.tsx, no /trends route. DB says "deployed" — incorrect. |
| 73 | Enrichment Queue page | PARTIAL | EnrichmentQueue.tsx exists but is NOT in routes.ts and hits /admin/enrichment-queue (no such API endpoint). |
| 79 | Sharp Claw proximity monitoring | BLOCKED | No scraper built. Blocked until factory_regions populated + Sharp Claw job scraping worker exists. DB says "deployed" — incorrect. |

**Completed this session (2026-04-07) — do not re-queue:**

| Task | Description |
|---|---|
| 70 | Add to Shortlist in SourcingView — modal live, existing + new list, success toast |
| 72 | DealFlow status-change reason field — modal before commit, optional reason passed to API |
| 68 | PartnerManagement full CRM — two-panel, tabbed detail, doc ingestion, notes, delete |
| 74 | Partner document ingestion — PDF/DOCX/TXT, pdfplumber, isolated DB tables, FTS search |
| 75 | Partner Advisory Terminal DB schema — protocols, cloud, hardware, regions, scaling_speed |
| 76 | Compatibility Index engine — ProtocolScore + MRLScore, 0-100, Tier labels |
| 77 | PartnerTerminal.tsx — dark institutional UI, DNA sidebar, 3 tabs |
| 78 | PartnerTerminal routing + navbar wiring |
| 80 | Build Queue tabs + superseded status fix |

**DB build_tasks audit finding:**
Tasks 52, 55, 57, 59, 60, 61, 65, 66, 67 are marked "superseded" in DB but were rendering as "Pending" in the UI due to missing STATUS_CONFIG entry. Fixed 2026-04-07. These are all done — do not rebuild.

**Enrichment status:**
108 companies were stuck as "failed" due to OPENROUTER_API_KEY not being loaded by cron (key is in .env, not in system environment). Reset to pending and re-ran with sourced .env. Fix the cron to source .env before worker invocation.

---

## Agents

| Agent | Port | Telegram | Role |
|---|---|---|---|
| BigBossHog | 18789 | @BigBossHogBot | Deploy, ops, task queue management |
| Big Claw | 18790 | @BigMfinClawbot | Code builder — pulls tasks, writes code, commits |
| Sharp Claw | 18791 | @therealresearcherbot | Research, enrichment, signal collection, briefing pipeline |

---

## Deploy Flow

1. Edit code on Refinery
2. `git push origin main`
3. `ssh nathan11@100.83.104.117 "bash ~/scripts/update_api.sh"` (git pull + API restart)

Or BigBossHog handles deploy automatically when a build task completes.

**React app:** Build on Refinery → commit `api/static/app/` → Dell pulls built assets.
