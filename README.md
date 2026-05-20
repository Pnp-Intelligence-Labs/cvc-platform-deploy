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

Full setup instructions: [`onboarding/SETUP_GUIDE.md`](onboarding/SETUP_GUIDE.md)
End-user guide (share with your team): [`onboarding/USER_GUIDE.md`](onboarding/USER_GUIDE.md)

---

## Local Development

```bash
bash scripts/run_local.sh        # starts PostgreSQL (Docker) + API at :8002
cd designs/figma-dashboard && npm run dev   # frontend dev server at :5173
```

Default login: `admin` / `changeme`

---

## Architecture

| Layer | Stack |
|---|---|
| Backend | FastAPI (Python 3.10+), port 8002 |
| Frontend | React SPA — Vite + Tailwind, served at `/app` |
| Database | PostgreSQL 16 (Docker) |
| Auth | JWT HS256, 7-day tokens |
| Plugins | Discovered from `plugins/installed/` at startup |

```
├── api/                    # FastAPI backend
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
