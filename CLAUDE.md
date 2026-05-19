# cvc-intelligence — Project Instructions

Main platform repo for Claw Venture Capital. Runs on the Dell server (100.83.104.117).

## Infrastructure

| Machine | Hostname | IP | User | Specs | Role |
|---|---|---|---|---|---|
| Dell R620 (basement) | nlouserv | 100.83.104.117 | nathan11 | 24 cores, 96GB RAM | BigBossHog, Big Claw, PostgreSQL, API, all workers |
| Refinery/WSL | — | 100.114.250.70 | nathan | RTX 3090 | Primary dev machine — Claude Code, Ollama, git origin, briefing enrichment worker |
| Lenovo (Whip Claw) | — | 100.74.101.77 | User | — | Memory / monitoring |

## Structure

```
cvc-intelligence/
├── api/
│   ├── main.py           # FastAPI app (port 8001) — all route prefixes set here
│   ├── auth.py           # JWT auth shim (delegates to routes/auth.py)
│   ├── routes/
│   │   ├── companies.py  # GET /companies/, /companies/sectors, /companies/{id}, DELETE /companies/{id}
│   │   ├── sourcing.py   # GET /sourcing/
│   │   ├── portfolio.py  # GET /portfolio/, /portfolio/stats
│   │   ├── dealflow.py   # GET/POST /dealflow/, /dealflow/intake, /dealflow/upload/{id}
│   │   ├── partners.py   # GET /partners/
│   │   ├── lp.py         # GET /lp/overview, /lp/sectors, /lp/signals
│   │   ├── intelligence.py
│   │   ├── industrial.py
│   │   ├── tasks.py      # GET/POST /tasks/, /tasks/{id}/approve
│   │   ├── trends.py
│   │   ├── shortlists.py
│   │   └── enrichment.py # includes POST /admin/quickadd
│   └── static/
│       ├── app/          # React app (Vite build) — served at /app
│       └── *.html        # Legacy HTML pages
├── core/                 # Shared utilities (PYTHONPATH here)
├── designs/
│   └── figma-dashboard/  # React source (Vite + Tailwind + recharts)
│       └── src/app/
│           ├── pages/    # PortfolioHomepage, CompanySearch, BuildQueue, etc.
│           └── components/ # CVCNavbar, AddDealModal, etc.
├── workers/
│   ├── dd/               # Due diligence pipeline (run_three.py)
│   ├── enrichment/       # enrich_worker.py (Phase 1), enrich_phase2.py (Phase 2), enrich_deep.py (deep: Brave Search → news/case studies + 4D)
│   ├── scoring/          # score_refresh.py
│   ├── scrapers/         # weekly_signals.py
│   ├── import/           # import_intros.py, import_portfolio.py
│   └── briefing/         # Weekly briefing pipeline
└── core/db/migrations/   # SQL migrations (127 current as of 2026-05-13)
```

## DD Pipeline (workers/dd/)

**Trigger:** Fully on-demand via the platform UI. No nightly cron, no BigBossHog approval queue.
- Analyst uploads dataroom files on the Enrichment Queue page (Add to Queue → DD Pipeline)
- Files are routed per-agent manually, or via Auto Ingest (ingestion agent handles routing automatically)
- Two-step flow: "Upload Dataroom" → confirmation → "Start DD Pipeline" fires immediately
- API endpoint: `POST /admin/dd/{company_id}/trigger?mode=full`

**Run pipeline manually (on Dell server, for debugging):**
```bash
cd /home/nathan11/repos/cvc-intelligence/workers/dd
PYTHONPATH=/home/nathan11/repos/cvc-intelligence/core python3 run_three.py --company "Company Name"
```

**Agents (5 specialists + overview + appendix + format):**
| Agent | Input | Output |
|---|---|---|
| `agents/financials` | P&L, cap table, projections, SAFE notes | `agents/financials.json` |
| `agents/comp` | Customer contracts, patent IP | `agents/comp.json` |
| `agents/qualitative` | Team bios, legal terms, customer contracts | `agents/qualitative.json` |
| `agents/product` | Patent IP, customer contracts | `agents/product.json` |
| `agents/news` | Web search only (no documents) | `agents/news.json` |
| `overview/agent` | All 5 agent JSONs | `overview.json` — IC memo + recommendation |
| `appendix/agent` | Agent JSONs + overview.json | `appendix.json` |
| `format/agent` | overview.json + appendix.json | `*_IC_Memo.pdf`, `*_Appendix.pdf`, `*_Scorecard.xlsx` |

**Routing rules:**
- Each file is routed to one or more agents via `routing_override.json` (analyst-specified) or ingestion tagger (Auto Ingest)
- `"general"` routing = file sent to all 4 specialist agents (use for pitch decks, company overviews)
- `ALWAYS_SHARE` doc types (`pitch_deck`, `investor_qa`, `unknown`) go to all agents automatically

**Analyst Review (Step 2):**
- Analyst downloads Scorecard XLSX from Enriched tab, fills in Accuracy / Flag Rating / Notes columns
- Upload annotated scorecard at Enrichment Queue → DD Pipeline → Step 2 Analyst Review
- API: `POST /enrichment/dd/{company_id}/submit-review` — parses feedback, stores in `cvc.dd_feedback`
- Reviewer agent (`agents/reviewer/agent.py`) runs in background → writes `review_memo.json`
- Format agent renders `*_Review_Memo.pdf` (with amber banner) and `*_Review_Memo.docx` (editable Word)
- Both files appear in the Enriched tab as "Memo PDF" and "Memo DOCX" download links

**Learning feedback loop:**
- After each analyst review, `cvc.dd_feedback` rows are aggregated into `platform_settings.dd_agent_learning`
- Pattern: which agent+topic combinations are most over-flagged or under-detected across all reviewed runs
- DD agents read this on next run via ConfigLoader — informs flagging sensitivity over time

**Key facts:**
- `extract_dataroom.py` handles ZIPs only — not folders
- `ingest_local.py` runs automatically when no manifest exists
- Outputs: `workers/dd/workdir/[CompanyName]/` — all JSON + PDF + XLSX files
- DB table: `cvc.dd_feedback` (migration 081) — per-finding analyst corrections
- DB table: `cvc.dd_evaluations` — pipeline completion log, logged after each run

## API

- Port 8001, FastAPI, running on Dell server
- Restart: `~/scripts/start_api.sh`
- Health: `curl http://localhost:8001/health`

## Database

```
host=localhost (on Dell server), dbname=cvc_db, user=producer, password from CVC_DB_PASSWORD
Remote access via Tailscale: host=100.83.104.117
schema: cvc
47 tables total. Key tables:
  companies (~1,700+)          — core company records, scoring, enrichment
  company_robotics             — robotics-specific capability matrix
  funding_rounds               — funding history per company
  build_tasks                  — BigBossHog task queue
  agent_memory                 — all agent memory logs (source of truth)
  dd_evaluations               — DD pipeline outputs per company
  company_lifecycle            — stage transitions and lifecycle events
  company_activity_log         — every manual field edit, analyst attribution
  home_team_messages           — admin messages shown on homepage
  partner_documents            — partner uploads (largest table: ~672 MB)
  raw_signals                  — weekly RSS signals and intelligence
  cron_jobs                    — worker enable/disable gates
  shortlists                   — curated company lists
  strategic_matcher_rules      — strategic matching config (migration 079)
  entities                     — named entities extracted from signals (migration 078)
  platform_settings            — global platform config KV store (migration 077)
  users                        — platform user accounts (JWT auth)
  roles                        — GP, Principal, Director, Ventures, PSM, Senior PSM
  term_sheets                  — investment records; UNIQUE(company_id, fund)
  partner_service_usage        — per-partner per-year service tracking
  partner_contracts            — uploaded PDFs + extracted metadata
```

## Platform Users (cvc.users — as of 2026-05-01)

Passwords are managed outside git. JWT auth via `POST /auth/login`.

| Username | Role | Notes |
|---|---|---|
| nate | GP | Full access |
| jerry | Principal | Ventures team |
| harvey | Principal | Ventures team |
| harshal | Principal | Ventures team |
| frederik | Director | Full access except build config |
| harry | Senior PSM | All partners assigned |
| alaina | PSM | Daimler Truck NA, GS1 US |
| jana | PSM | Ingersoll Rand |
| yukino | PSM | Costco, TJX, Japan Post, Mitsubishi Electric, Dot Foods, SolidWorks |

PSM `assigned_partner_ids` live in `cvc.users`. PSMs must re-login after assignment changes to get updated JWT.

## Deployment

Both BigBossHog and Big Claw run on the Dell server. Big Claw builds and commits to GitHub.
BigBossHog (task_deployer.py) pulls from GitHub locally and restarts the API.

Deploy script: `~/scripts/update_api.sh` (local git pull, no Refinery relay)

Always `git pull` in `~/repos/cvc-intelligence` before starting any task.

## React App

- Source: `designs/figma-dashboard/` (Vite + React + Tailwind + recharts)
- Build: `cd designs/figma-dashboard && npm run build` — outputs to `api/static/app/`
- Served at: `http://[server]:8001/app`
- Routes: `/` (Homepage), `/portfolio`, `/companies`, `/company/:id`, `/sourcing`, `/partners`, `/industrial`, `/lp-portal`, `/enrichment`, `/admin`
- `/sectors`, `/sectors/:sector`, `/trends` all redirect → `/industrial`
- `/partners/admin` redirects → `/admin`
- `/tasks` — **removed as standalone page** (merged into `/admin` as "Task Queue" tab, 2026-04-16). `BuildQueue.tsx` is the source component, now rendered as a tab inside `Admin.tsx`.
- `/partners/list` — **removed** (PartnerManagement PSM page deleted 2026-04-14)
- Auth header in all fetch calls: `Authorization: Bearer <JWT>`
- **After every build, commit `api/static/app/` to git** — Dell pulls the built assets

## Homepage Layout

Linen-background dashboard (`bg-linen` / `#FAF9F6`). Layout top-to-bottom:

1. **From the Team** — Home Team Messages block (left column, only shown when messages exist)
2. **Leaderboards** — full-width 3-column widget above the main grid. Three static boards: Startups Sourced, Introductions, Partner Data. Team members: Nate, Harry, Jerry. Static placeholder counts until wired to live DB queries.
3. **Main grid (xl:col-span-2 + sidebar)**
   - Left (2/3): Weekly briefings, collapsible newest-first
   - Right (1/3): Recent Activity feed, OpenRouter Usage widget
4. **OpenRouter Usage** — moved to right column sidebar (was full-width above grid). Period totals (today/week/month) + per-activity cost bars.
5. **Quick Access removed** — replaced by OpenRouter Usage widget in right column.

## Key DB Columns (cvc.companies)

- Sectors are Title Case: `Supply Chain`, `Robotics`, `Manufacturing`, `Industrial Automation`, `Physical AI` — never snake_case
- `is_portfolio` (bool) — 67 portfolio companies flagged TRUE
- `intro_count`, `intro_partners` (jsonb), `last_intro_date` — **live subqueries only** (correlated from `cvc.partner_intros`). The stale columns on `companies` are deprecated. Always alias `FROM cvc.companies c` and reference `c.id` in the subquery — bare `id` resolves to the wrong alias.
- `env_4d`, `func_4d`, `stack_4d`, `biz_model_4d` — 4D classification
- `score_composite`, `score_irs`, `score_sri`, `score_tdf`, `score_commercial`, etc. — scoring
- `investors`, `tags` are `text[]` — NOT jsonb. Never use `json.dumps()` or `::jsonb` cast for these.
- `news_articles`, `case_studies` are `jsonb` — populated by `enrich_deep.py` (Brave Search); each is an array of `{title, url, snippet, age}` objects.
- **Enrichment step timestamps** (all `TIMESTAMPTZ`, set by each worker on completion regardless of findings):
  - `founder_enriched_at` — set by `founder_research.py` (migration 092)
  - `fourd_enriched_at` — set by `enrich_4d.py` (migration 092)
  - `funding_enriched_at` — set by `enrich_funding_rounds.py` (migration 091)
  - `cases_enriched_at` — set by `enrich_cases.py` / `enrich_deep.py` (migration 087)
- **`GET /admin/status/{company_id}`** returns `{done: bool, last_run: "M/D/YY" | null}` per step key (`founder`, `fourD`, `funding`, `cases`). UI polls this to resolve the enrichment panel. `done` = data exists; `last_run` = step was run (non-null even when no findings).
- `company_activity_log` table (migration 050): tracks every manual field edit with `company_id`, `changed_by` (username), `changed_at`, `field_name`, `old_value`, `new_value`, `change_source`. Used for analyst attribution and bias audit trail.
- `home_team_messages` table (migration 051): admin-posted messages shown on the homepage. Columns: `id`, `title`, `body`, `posted_by` (username), `pinned` (bool), `created_at`. Pinned messages sort first.

## Market Intelligence Engine

Three-layer pipeline: collect → enrich → match → brief.

### ConfigLoader (`core/config_loader.py`)

Singleton that loads `cvc.platform_settings` once per process. Never raises — falls back to `SAFE_DEFAULTS` if DB is unreachable. Import as:

```python
from config_loader import config as _cfg
thesis = _cfg.get("investment_thesis")
```

**All four keys are live and wired:**

| Key | Where used |
|---|---|
| `investment_thesis` | `enrichment_worker.py`, `weekly_briefing.py`, `weekly_delta.py` |
| `corporate_partners_context` | same three workers |
| `sector_focus` | `enrichment_worker.py` relevance scoring |
| `analyst_context` | `enrichment_worker.py` enrichment prompt |

To update thesis context: edit via `UPDATE cvc.platform_settings SET value = '...' WHERE key = '...'` — ConfigLoader reloads on next worker restart (or call `config.reload()`). **Do not hardcode thesis strings in worker scripts.**

### Naming Integrity — Live Protocols

**`cvc.entities`** (migration 078) — named entity discovery layer.
- Populated by `entity_resolver.py` Phase 1 (scan `content_items.key_entities.companies`)
- Resolved against `cvc.companies` by Phase 2 (fuzzy match ≥ 0.85) → sets `company_id + match_confidence`
- If `company_id IS NULL` after resolution: entity is a known mention not yet in the pipeline — a discovery signal

**`cvc.entities → cvc.partners`** (migration 079) — strategic partner mention tracking.
- `strategic_matcher_worker.py` runs pgvector cosine similarity (mxbai-embed-large, 1024-dim, threshold 0.82)
- Resolves entity variants ("Honeywell Aerospace", "Honeywell USA") → single `cvc.partners` row via `partner_id + partner_confidence`
- HNSW index on `partners.name_embedding` for fast retrieval
- **There is no `cvc.strategic_clients` table.** CVC partner tracking uses `cvc.partners` + `cvc.entities.partner_id`.

### Audio Pipeline

`diarize_podcast.py` — WhisperX large-v3 + Pyannote 3.1, runs on Refinery GPU.
- Called by `fetch_podcasts.py` as primary transcript source; falls back to YouTube captions if diarization fails
- Output format: `[SPEAKER_00]: text...` — speaker-labeled turn text stored as `raw_text` in `content_items`
- `enrichment_worker.py` then runs `generate_podcast_synthesis()` via kimi-k2.5 → extracts `{insight, expert, section, confidence}` objects
- Stored as `podcast_synthesis JSONB` on `content_items`; consumed by `weekly_briefing.py` to surface HIGH/MEDIUM confidence insights with expert attribution
- **There are no `expert_name`/`expert_claim` DB columns.** Expert data lives inside the `podcast_synthesis` JSONB as `insights[].expert` and `insights[].insight`.

## Briefing Pipeline (workers/briefing/)

**Enrichment worker runs on Refinery** (not Dell) — uses RTX 3090 via Ollama.
Cron on Refinery at 4:30 AM UTC daily: `~/scripts/run_briefing_enrichment.sh`

| Task | Model | Where |
|---|---|---|
| Relevance + enrichment | `qwen3:30b-a3b` | Refinery Ollama (local GPU) |
| Podcast synthesis | `moonshotai/kimi-k2.5` | OpenRouter cloud |
| Fallback | `qwen/qwen3-235b-a22b-2507` | OpenRouter cloud |

Weekly briefing generator still runs on Dell (Sunday 5:00 AM UTC): `workers/briefing/weekly_briefing.py`

Archive of old Dell-only workflow: `git tag archive/briefing-enrichment-dell-v1`

## Company Management

**Delete a company:** `DELETE /companies/{id}` — hard deletes the company row and cascades to `company_robotics`, `funding_rounds`, `company_lifecycle`, `dd_evaluations`. UI: trash icon in CompanyProfile header triggers inline red confirmation before firing.

**Edit a company:** `PATCH /companies/{id}` with any subset of editable fields — updates the row and logs every changed field to `company_activity_log` with the authenticated analyst's username. Returns the full updated profile.

**View activity log:** `GET /companies/{id}/activity` — returns last 100 change entries. Shown at the bottom of every company profile. Column "Analyst" shows who made each edit, enabling analyst-startup attribution.

**Quick Add by URL:** `POST /admin/quickadd` with `{ "url": "https://..." }` — scrapes the website, runs LLM enrichment to seed name/sector/stage/one_liner, saves to DB with `enrichment_status='pending'` and `enrichment_source='quickadd'`. The nightly Phase 1 worker then does full enrichment; Phase 2 scores it. Company is visible in the Enrichment Queue pending list immediately.

## Admin Page (/admin)

Top-level page in the navbar (`designs/figma-dashboard/src/app/pages/Admin.tsx`). Two tabs:

**Partner Issues tab** — migrated from the old `/partners/admin` route. Shows all open partner issues across all partners with severity filter (high/medium/low), inline edit, resolve toggle, delete, and threaded progress-update comments. Partner name links to the partner terminal.

**Home Team Messages tab** — admin posts directions, initiatives, or reminders to the team.
- Compose form: title, body, optional pin toggle → `POST /home/messages`
- Posted messages list with expand/collapse and delete
- Pinned messages sort to the top and are highlighted

**Homepage display:** `GET /home/messages` is fetched at dashboard load. Messages appear in a "From the Team" block at the top of the briefing column, replacing the old notifications banner. Each card shows title + one-line preview; click "Read →" to expand the full body inline. Block is hidden entirely when no messages exist.

**API endpoints (prefix `/home`):**
- `GET /home/messages` — list all messages, pinned first
- `POST /home/messages` — `{ title, body, pinned }` — `posted_by` set from auth username
- `DELETE /home/messages/{id}` — hard delete

**PartnerHub (`/partners`):** Full PSM hub at `PartnerManagement.tsx`. Landing screen (`PSMHub` component) shows PSM Performance, Corporate Traction, and a tab bar for each PSM (Harry/Alaina/Jana/Yukino). Clicking a PSM tab filters the partner grid to their assigned accounts. Selecting a partner opens the detail panel. `PartnerManagement.tsx` is the live file — it is NOT dead code.

## Worker Job Gates

All nightly workers check `cvc.cron_jobs.active` before running — toggling the scheduler UI actually stops the worker. Pattern uses `is_job_enabled(name)` from `core.db.connection` (fail-open: returns True if DB unreachable or row missing).

Gated workers and their job names:
- `enrich_worker.py` → `"Company Enrichment — Phase 1"`
- `enrich_phase2.py` → `"Company Enrichment — Phase 2"`
- `score_refresh.py` → `"Scoring Refresh"`
- `weekly_signals.py` → `"Weekly Signals Scraper"`
- `weekly_briefing.py` → `"Weekly Briefing Generation"` (inline check, own psycopg2 conn)
- `run_collectors.py` → `"RSS / Content Collection"` (inline check, own psycopg2 conn)

Note: shell-based cron jobs (DB backup, API watchdog) cannot use the DB gate — they're always-on.

## Industrial Intelligence Page (/industrial)

Merged from three former pages: Industrial, Sectors, Trends. Single page with:
- Sector pills (Robotics, Supply Chain, Manufacturing, Industrial Automation, Physical AI)
- KPI row (company count, avg readiness, integration kings, avg sovereignty)
- Matrix tab, Geopolitical tab, Intelligence tab (narrative + funding chart + signals)
- Signal breakdown charts (composite tier + sovereignty tier) derived from live matrix data
- Company cards for selected sector

Old routes `/sectors`, `/sectors/:sector`, `/trends` all 301 → `/industrial`.

## React Design System

**Single source of truth:** `designs/figma-dashboard/src/app/components/tokens.ts`
All 18 pages import `{ cls }` from this file. Change a token → rebuild → every page updates.

**Tailwind v4** — no `tailwind.config.js`. Custom tokens live in `designs/figma-dashboard/src/styles/tailwind.css` under `@theme {}`:
```css
@theme {
  --color-linen:      #FAF9F6;   /* page background */
  --color-cvc-gold:   #F59E0B;   /* amber accent */
  --color-cvc-slate:  #1e293b;   /* dark surfaces / primary text */
  --shadow-cvc:       0 1px 2px 0 rgb(0 0 0 / 0.04), 0 4px 16px 0 rgb(0 0 0 / 0.06);
  --shadow-cvc-hover: 0 2px 4px 0 rgb(0 0 0 / 0.06), 0 8px 24px 0 rgb(0 0 0 / 0.08);
}
```
These become Tailwind utilities: `bg-linen`, `text-cvc-gold`, `bg-cvc-slate`, `shadow-cvc`, etc.

**Key `cls` tokens:**
- `cls.page` — `min-h-screen bg-linen text-slate-900 font-sans` (all page wrappers)
- `cls.card` / `cls.cardPadded` — white card with `shadow-cvc`, `border-slate-200`
- `cls.subcard` / `cls.subcardSm` — nested inner cards, no shadow
- `cls.dataArea` — `bg-[#F8FAFC]` stats/info panels
- `cls.pageTitle` — `text-3xl font-extrabold tracking-tight text-[#1E293B]`
- `cls.sectionTitle` — `text-lg font-bold text-[#334155]`
- `cls.meta` / `cls.eyebrow` — monospace uppercase 10px labels
- `cls.input` / `cls.inputFull` / `cls.select` — parchment `#ede8d7` bg inputs
- `cls.btnPrimary` — `bg-[#1E293B] text-cvc-gold`

**Chart palette (Industrial Neon):** Indigo `#6366F1`, Pink `#EC4899`, Cyan `#06B6D4`, Amber `#F59E0B`, Violet `#8b5cf6`, Emerald `#10b981`. Full sector → color map in `chartColors` export.

**PartnerTerminal intentionally excluded** — Bloomberg dark terminal stays dark, no linen treatment.

## Route Prefix Rule

**Prefixes are ALWAYS set in `main.py` `include_router(prefix=...)`.**
Never set a prefix in `APIRouter()` constructor. This is mandatory — violating it breaks routing.

## Git Workflow

**Before making ANY edit — always pull first:**
```bash
cd ~/repos/cvc-intelligence && git pull origin main
```
BigClaw commits to GitHub from Dell throughout the day. If you edit without pulling first,
your push will be rejected and you'll have a merge conflict to resolve.

- Refinery is the authoritative dev machine. All edits happen here, push to GitHub, Dell pulls.
- Dell must never be ahead of `origin/main`. If push fails: `git pull --rebase origin main` then push.
- Deploy: `ssh nathan11@100.83.104.117 "bash ~/scripts/update_api.sh"`

## Secrets Management

**Never hardcode credentials** — they show up in plaintext in crash logs.

All secrets live in `~/.env.secrets` (chmod 600, never committed) on each machine:

| Machine | Path | Contains |
|---|---|---|
| Dell | `/home/nathan11/.env.secrets` | `CVC_DB_PASSWORD`, `CVC_SMOKE_PASSWORD`, `JWT_SECRET`, `OPENROUTER_API_KEY`, `TELEGRAM_BOT_TOKEN`, `BRAVE_SEARCH_KEY`, `BRAVE_SEARCH_KEY_BACKUP` |
| Refinery | `/home/nathan/.env.secrets` | `CVC_DB_PASSWORD`, `HF_TOKEN`, `OPENROUTER_API_KEY` |

**How Dell uses it:**
- `start_api.sh` — sources it, exports `JWT_SECRET` + `CVC_DB_PASSWORD` + `OPENROUTER_API_KEY` to uvicorn
- `update_api.sh` — sources it for `CVC_SMOKE_PASSWORD` (smoke test JWT login)
- `start_workers.sh` — sources it, exports all vars before starting task workers
- **Crontab** — `SHELL=/bin/bash` + `BASH_ENV=/home/nathan11/.env.secrets` at top → all cron jobs inherit automatically

**API auth (added 2026-05-04 by Big Claw):**
- `JWT_SECRET` is required — API refuses to start without it (RuntimeError)
- `CVC_SMOKE_PASSWORD` is required for smoke test in `update_api.sh`
- Both are set in Dell's `~/.env.secrets`

**PYTHONPATH for workers (on Dell):**
- Must be `/home/nathan11/repos/cvc-intelligence` (repo root) so `core` is importable
- `start_workers.sh` sets `PYTHONPATH=$REPO` inline in the nohup command (not via export — nohup doesn't reliably inherit)
- Import pattern everywhere: `from core.db.connection import get_connection` — never `from db.connection`

## OpenClaw Agent Ecosystem

Canonical identity and config files live in `~/repos/cvc-agent-configs/` (GitHub: `natelouie11-tech/cvc-agent-configs`).
**This repo is the source of truth for all agents.** Do not treat workspace copies as authoritative.

| Agent | Machine | IP | Port | Role |
|---|---|---|---|---|
| BigBossHog | Dell R620 (nathan11) | 100.83.104.117 | 18789 | Operator — deploys, tests, publishes tasks (@BigBossHogBot) |
| Big Claw | Dell R620 (nathan11) | 100.83.104.117 | 18790 | Builder — writes code, commits to GitHub (@BigMfinClawbot) |
| Sharp Claw | Dell R620 (nathan11) | 100.83.104.117 | 18791 | Research — enrichment, signals, DD, trend synthesis (@therealresearcherbot) |
| Whip Claw | Lenovo WSL (User) | 100.74.101.77 | — | Watchdog — monitors, documents, alerts |
| Real Claw | Oracle Cloud | 100.84.215.64 | — | Calgary platform (separate project) |

**Live workspace paths (on each machine):**
- BigBossHog: `/home/nathan11/.openclaw/workspace/`
- Big Claw: `/home/nathan11/.openclaw-bigclaw/workspace/`
- Sharp Claw: `/home/nathan11/.openclaw-sharpclaw/workspace/`
- Whip Claw: `/mnt/c/Users/User/.openclaw/workspace/`

**Each agent config dir contains:** `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `AGENTS.md`, `HEARTBEAT.md`, `MEMORY.md` (and agent-specific extras).

Sync script: `~/scripts/sync_agent_configs.sh` — pushes live files → GitHub weekly.
Whip Claw monitors drift between live workspace files and this repo.

**Restart commands (on Dell):**
```bash
# BigBossHog / Sharp Claw
systemctl --user restart openclaw-gateway
systemctl --user restart openclaw-gateway-sharpclaw

# Big Claw task worker (only task_worker_agent.py is a daemon — task_worker.py is a one-off intel script)
bash ~/scripts/start_workers.sh
```

## Brambles Strategic Fund Pipeline

Independent advisory pipeline where CVC stress-tests Brambles Capital's tier assessments against independent web evidence. The deliverable is a CVC-authored IC memo: agree/disagree/partial on each Brambles tier classification, with evidence and reasoning.

**Brambles DD Engine** — isolated Python package at `/home/nathan11/repos/brambles_dd_engine/` on Dell.
- Synced from Refinery via rsync (not git): `rsync -av /home/nathan/repos/brambles_dd_engine/ nathan11@100.83.104.117:/home/nathan11/repos/brambles_dd_engine/`
- Config lives in `brambles_dd_engine/config/` — company screening list, tier criteria

**Route:** `api/routes/brambles.py`, prefix `/brambles` set in `main.py`
**React page:** `designs/figma-dashboard/src/app/pages/BramblesReview.tsx` — analyst review UI at `/brambles/review/:id`

### DB Tables

**`cvc.brambles_pipeline`** — one row per company in the Brambles Strategic Fund screening list
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `company_name` | text | |
| `analyst_tier` | text | Brambles' assigned tier (e.g. "Tier 1", "Tier 2") |
| `sector` | text | |
| `website` | text | |
| `enrichment_status` | text | `pending` → `running` → `complete` → `error` |
| `ic_memo_json` | jsonb | Full analysis output including `enrichment` sub-key |
| `review_status` | text | `pending` (not yet finalized) → `complete` (analyst locked review) |
| `review_memo_json` | jsonb | Final prose memo from the review agent |
| `review_memo_path` | text | Path to saved HTML memo file |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**`cvc.brambles_feedback`** — analyst verdicts per claim, per section
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `pipeline_id` | int | FK → `brambles_pipeline.id` |
| `section` | text | e.g. `"background"`, `"deployment"`, `"customers"`, `"founder"` |
| `item_index` | int | Index of the claim within the section |
| `item_text` | text | The claim text shown to the analyst |
| `verdict` | text | `agree` / `disagree` / `neutral` |
| `note` | text | Analyst reasoning (optional but used in memo generation) |
| `created_at` | timestamptz | |

**`platform_settings.brambles_agent_learning`** (key in `cvc.platform_settings`)
- Aggregated disagreement rates per section across all finalized reviews
- Updated after each `finish-review` call via `_update_brambles_learning()`
- Informs enrichment prompt sensitivity on future runs (sections with >40% disagree rate get flagged)

### Enrichment Flow

`_enrich_brambles_web()` — runs 4 rounds of Brave searches per company:
- **D1-D5** — deployment evidence (customer names, pilot programs, contracts)
- **F1-F4** — funding evidence (rounds, investors, amounts)
- **R1-R4** — reputation / market position (awards, partnerships, press)
- **G1-G4** — founding team (backgrounds, exits, credentials)

Each search round builds a numbered source index (`D1`, `F2`, etc.) → LLM (qwen3-235b) synthesizes findings and cites source IDs inline → IDs resolved to `{title, url, snippet}` objects.

Per-claim source attribution stored in `ic_memo_json.enrichment`:
- `deployment_sources`, `customer_sources`, `founder_sources` — arrays of `{id, title, url, snippet}`
- `key_facts` — array of `{text, sources[]}` objects (sources = subset of the above)

### Review Flow

1. Analyst opens Enrichment Queue → Brambles Fund tab → clicks company row → `/brambles/review/:id`
2. Review page shows IC memo cards: Background, Deployment Evidence, Customer Evidence, Founding Team, Summary
3. Each claim has: verdict selector (Agree/Neutral/Disagree), textarea for analyst note, Confirm button
4. Confirmed note locked as a quoted annotation; border changes (green=agree, red=disagree, slate=neutral)
5. Header shows: "X confirmed · Y voted", tier delta badge (CVC tier vs Brambles tier), Save Review + Finish Review buttons
6. **Finish Review**: saves all feedback, calls `POST /brambles/companies/{id}/finish-review` → triggers `_generate_review_memo_bg()` background task
7. Page polls every 4s for `review_memo_json`; View Memo button (emerald) appears when ready

**Tier delta logic:**
- `tierDelta = cvcTierNum - bramblesTierNum` (negative = CVC rates higher, positive = CVC rates lower)
- Badge colors: green (CVC agrees or rates higher), amber (slight delta), red (significant disagreement)

### Memo Agent

`_generate_review_memo_bg()` — background task, runs after Finish Review:
1. Reads all verdicts + analyst notes from `cvc.brambles_feedback` for this company
2. Reads `ic_memo_json` enrichment data
3. Calls qwen3-235b via OpenRouter — produces full prose IC memo (no bullet lists)
4. Memo schema:
   - `investment_overview` — paragraph
   - `cvc_vs_brambles` — `{brambles_tier, cvc_tier, agreement: agree|partial|disagree, rationale}`
   - `commercial_traction` — paragraph
   - `founding_team` — paragraph
   - `key_evidence` — 4-6 confirmed bullets
   - `risks_and_gaps` — paragraph
   - `brambles_fit` — paragraph
   - `recommendation` — `Pursue|Monitor|Pass`
   - `recommendation_paragraph` — closing paragraph
5. `_render_review_memo_html()` renders professional printable HTML (Merriweather + Inter, tier comparison table, colored verdict badge, print CSS)
6. Saved to `api/static/brambles/{company_id}/review_memo.html`
7. `_update_brambles_learning()` aggregates disagree rates, writes to `platform_settings`

### API Endpoints (prefix `/brambles`, set in `main.py`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/brambles/companies` | List all pipeline companies with enrichment status |
| `POST` | `/brambles/companies/{id}/enrich` | Trigger web enrichment for a company |
| `GET` | `/brambles/companies/{id}` | Get company details + ic_memo_json |
| `GET` | `/brambles/companies/{id}/feedback` | Get all analyst feedback rows |
| `POST` | `/brambles/companies/{id}/feedback` | Save/update feedback for a claim |
| `POST` | `/brambles/companies/{id}/finish-review` | Lock review + trigger memo agent |
| `GET` | `/brambles/companies/{id}/download/review-memo` | Download HTML memo |

### Output Files

`/home/nathan11/repos/cvc-intelligence/api/static/brambles/{company_id}/`
- `review_memo.html` — printable CVC vs Brambles IC memo

### Known Issues

- `lab0.ai` — web_search_ran: false (company name too generic for Brave to return meaningful results; manual check needed)
- OpenRouter credits must be active — 402 errors silently set `web_search_ran: false` without failing the run

## Git Remotes

- `origin`: GitHub (natelouie11-tech/cvc-platform-deploy) — this repo (feature stripping / platform generalization work)
- **Do NOT push changes here to NEW-CVC-REPO (cvc-intelligence).** These are separate workstreams.
