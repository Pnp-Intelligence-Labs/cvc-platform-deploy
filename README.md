# Vertical OS — Plug and Play VC Platform

A self-hosted, single-tenant operations platform for venture capital teams.
Deploy it on your own server in under an hour. Your data never leaves your infrastructure.

---

## What's Included

### Core Platform

| Section | What it does |
|---|---|
| **Homepage** | Role-aware dashboard — KPIs, pipeline summary, team activity, leaderboard |
| **Ventures** | Company database, deal flow pipeline, CSV import, bulk enrichment |
| **Partners** | Corporate partner CRM — contacts, matched startups, notes, documents, CSV import |
| **Partner Terminal** | Per-partner deep-dive: advisory logs, document intel, AI-assisted briefing |
| **Sales Pipeline** | Outbound deal tracking by stage |
| **Requests** | Inbound partnership requests → triage → assignment workflow |
| **Meeting Notes** | Structured note-taking tied to companies and partners |
| **Admin** | User management, role assignment, partner assignments, plugin health |

### Plugins (optional)

Install any combination during setup or later. Each plugin ships with its own DB migrations.

| Plugin | Slug | What it adds |
|---|---|---|
| Enrichment Queue | `enrichment` | Automated company enrichment, DD workflow, quick-add by URL |
| Industrial Matrix | `industrial-matrix` | Sector readiness scoring with configurable metrics |
| Intelligence Feed | `intelligence-feed` | Weekly briefing pipeline — podcasts, research, signals |
| LP Portal | `lp-portal` | Fund metrics and LP-facing reporting |
| News Feed | `news-feed` | Company news tracking via Brave Search |
| Trend Reports | `trend-reports` | AI-assisted venture intelligence report builder |
| Data Explorer | `data-explorer` | Pre-built analytical reports — pipeline funnel, sector mix, stage breakdown |

---

## Quick Start

```bash
git clone https://github.com/natelouie11-tech/cvc-platform-deploy
cd cvc-platform-deploy
bash scripts/install.sh
```

The installer handles everything: dependencies → `.env` → team config → frontend build → database → migrations → plugin selection → optional demo data.

| Doc | Audience |
|---|---|
| [`onboarding/SETUP_GUIDE.md`](onboarding/SETUP_GUIDE.md) | Admin setting up the server |
| [`onboarding/GOLIVE_CHECKLIST.md`](onboarding/GOLIVE_CHECKLIST.md) | Admin — security + ops before going live |
| [`onboarding/DATA_MIGRATION.md`](onboarding/DATA_MIGRATION.md) | Admin — migrating from Airtable, Notion, Excel |
| [`onboarding/USER_GUIDE.md`](onboarding/USER_GUIDE.md) | Every team member logging in |
| [`onboarding/TEAM_INVITE.md`](onboarding/TEAM_INVITE.md) | Admin — copy-paste invite templates |

---

## Local Development

**Prerequisites:** Docker Desktop, Node 18+, [`uv`](https://docs.astral.sh/uv/getting-started/installation/)

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh   # install uv (once)
```

```bash
cp .env.example .env                              # fill in DB_PASSWORD and JWT_SECRET
uv sync                                           # install all Python deps
bash scripts/run_local.sh                         # PostgreSQL (Docker) + FastAPI at :8002
cd designs/figma-dashboard && npm run dev         # frontend dev server at :5173
```

Django backend (parallel migration, port 8003):

```bash
DJANGO_SETTINGS_MODULE=config.settings \
PYTHONPATH="$PWD/backend:$PWD" \
uv run python backend/manage.py runserver 8003
```

Default login: `admin` / `changeme`

### Dev workflow

```bash
uv run ruff check .          # lint
uv run ruff format .         # format
uv run basedpyright          # type check
```

### Demo data

Generate the SQL dump from your running local DB (run once, then commit):

```bash
docker exec platform-db sh -c "pg_dump -U platform platform_db" > data/demo_data.sql
```

Restore on a fresh install:

```bash
# via Docker container
docker exec -i platform-db psql -U platform platform_db < data/demo_data.sql
# or via local psql
psql -h localhost -U platform platform_db < data/demo_data.sql
```

---

## Architecture

| Layer | Stack |
|---|---|
| Backend (current) | FastAPI + Uvicorn, Python 3.11, port 8002 |
| Backend (migrating) | Django 5 + Django Ninja, port 8003 — incremental migration in progress |
| Frontend | React SPA — Vite + Tailwind, served at `/app` |
| Database | PostgreSQL 16 |
| Auth | JWT HS256, 7-day tokens (Keycloak OIDC scaffolded) |
| Tooling | `uv` package manager, `ruff` linter/formatter, `basedpyright` type checker |
| Plugins | Discovered from `plugins/installed/` at startup |

```
├── backend/                # Django Ninja backend (incremental migration from api/)
│   ├── manage.py
│   ├── config/             # Django project settings, urls
│   └── api/routes/         # Migrated route modules (Django Ninja)
├── api/                    # FastAPI backend (active)
│   ├── main.py             # App entry point — routes, CORS, plugin loader
│   ├── auth.py             # JWT auth middleware
│   ├── plugin_loader.py    # Discovers and mounts installed plugins
│   └── routes/             # One file per feature area
├── core/db/migrations/     # Numbered SQL migrations (idempotent)
├── designs/figma-dashboard/ # React SPA source
├── plugins/
│   ├── _staging/packages/  # All plugins (staged, not active)
│   └── installed/          # Active plugins (copied here to enable)
├── config/
│   └── team.json           # Runtime team config (name, sectors, fund names)
├── onboarding/             # Setup guide, user guide, sample CSVs
└── scripts/
    ├── install.sh          # One-command bootstrap
    ├── migrate.sh          # Run core + plugin migrations
    ├── run_local.sh        # Local dev stack
    ├── smoke_test.sh       # API smoke test (post-install verification)
    └── seed_demo.py        # Load 30 demo companies + 4 partners
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DB_HOST` | Yes | PostgreSQL host |
| `DB_PORT` | No | PostgreSQL port (default: 5432) |
| `DB_NAME` | No | Database name (default: platform_db) |
| `DB_USER` | No | DB user (default: platform) |
| `DB_PASSWORD` | Yes | DB password |
| `JWT_SECRET` | Yes | Secret for signing JWT tokens |
| `PORT` | No | API port (default: 8002) |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS origins |
| `OPENROUTER_API_KEY` | Plugin | AI enrichment, partner analysis, report builder |
| `BRAVE_API_KEY` | Plugin | Company news, research signals |
| `PROXYCURL_API_KEY` | Plugin | Founder LinkedIn data |
| `KEYCLOAK_URL` | Optional | Keycloak server URL for OIDC auth |
| `KEYCLOAK_REALM` | Optional | Keycloak realm name |
| `KEYCLOAK_CLIENT_ID` | Optional | Keycloak client ID |
| `KEYCLOAK_CLIENT_SECRET` | Optional | Keycloak client secret |
| `DJANGO_SECRET_KEY` | Django | Secret key for Django backend (port 8003) |

---

## Roles

| Role | Access |
|---|---|
| **GP** | Everything — full admin |
| **Principal / Director** | Everything except system configuration |
| **Ventures** | Companies, deal flow, DD, fund metrics |
| **PSM** | Assigned partners only, no fund data |

---

## Verification

After install, run the smoke test to confirm everything is working:

```bash
bash scripts/smoke_test.sh
```

---

## Key Docs

- [`onboarding/SETUP_GUIDE.md`](onboarding/SETUP_GUIDE.md) — admin setup and deployment guide
- [`onboarding/USER_GUIDE.md`](onboarding/USER_GUIDE.md) — end-user guide for team members
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — architecture decisions
- [`docs/PLUGIN_INTERFACE.md`](docs/PLUGIN_INTERFACE.md) — how to build a plugin
- [`PRODUCT_VISION.md`](PRODUCT_VISION.md) — product vision and design principles
