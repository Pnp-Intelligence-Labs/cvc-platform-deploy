# Ventures Platform

Internal operations platform for venture capital teams. Manages deal flow, partner CRM, sourcing, requests, and portfolio tracking.

**This repo is the generalized version of CVC Intelligence** — stripped of fund-specific features and built for deployment to any VC team.

---

## Architecture

- **Backend:** FastAPI (Python), port 8002
- **Frontend:** React SPA (Vite + Tailwind), served at `/app`
- **Database:** PostgreSQL 16
- **Auth:** JWT (HS256, 7-day tokens)
- **Deployment:** Docker Compose

---

## Core Features

| Section | Description |
|---|---|
| Homepage | Configurable team + personal widgets, Google Calendar |
| Ventures | Startup tracking, CSV import, deal flow, portfolio tab |
| Partners | Partner CRM — team-managed data |
| Sales Pipeline | Deal stage tracking |
| Requests | PSM service requests → task assignment workflow |
| Quick Notes | Meeting notes and observations |

**Plugins** (optional, shipped separately): LP Portal, Advisory Terminal, Industrial Matrix, Intelligence Feed, DD Pipeline, Portfolio News, Meeting Intelligence

---

## Local Development

### Prerequisites
- Docker + Docker Compose
- Python 3.11+
- Node 18+ (for frontend)

### First-time setup

```bash
# 1. Clone and enter the repo
git clone https://github.com/natelouie11-tech/cvc-platform-deploy
cd cvc-platform-deploy

# 2. Create your .env
cp .env.example .env
# Edit .env: set JWT_SECRET (any random string is fine for dev)

# 3. Start the platform
bash scripts/run_local.sh
```

This will:
- Pull and start PostgreSQL in Docker
- Run all DB migrations
- Create a Python venv and install dependencies
- Start the API at http://127.0.0.1:8002

### Stopping the DB

```bash
bash scripts/run_local.sh --stop
```

### Running the frontend (hot reload)

```bash
cd designs/figma-dashboard
npm install
npm run dev
# Runs at http://localhost:5173 — proxies API calls to :8002
```

### Run migrations only

```bash
bash scripts/migrate.sh
```

---

## Deployment (Docker)

```bash
cp .env.example .env
# Fill in all values — especially DB_PASSWORD and JWT_SECRET

docker compose up -d

# Run migrations (first deploy only)
bash scripts/migrate.sh
```

---

## Project Structure

```
├── api/
│   ├── main.py              # FastAPI app — routes, CORS, SPA fallback
│   ├── auth.py              # Auth shim (require_auth)
│   ├── routes/              # One file per feature area
│   └── static/app/          # Built React SPA
├── core/
│   ├── config.py            # Shared config (API keys, model names)
│   └── db/
│       ├── connection.py    # DB connection (reads DB_* env vars)
│       └── migrations/      # Numbered SQL migrations (idempotent)
├── designs/
│   └── figma-dashboard/     # React SPA source (Vite + Tailwind)
├── workers/                 # Background workers
├── plugins/
│   └── _staging/            # Plugin code staged for packaging
├── scripts/
│   ├── run_local.sh         # Start local dev environment
│   └── migrate.sh           # Run DB migrations
├── docker-compose.yml       # Production: API + DB
├── docker-compose.dev.yml   # Dev: DB only
├── Dockerfile
└── .env.example
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

Plugin API keys (OPENROUTER_API_KEY, BRAVE_API_KEY, PROXYCURL_API_KEY) are only needed if plugins are installed.

---

## Key Docs

- `docs/PHASE1_BUILD_PLAN.md` — auth + roles build plan (complete)
- `docs/DECISIONS.md` — architecture decisions (do not re-litigate)
- `PRODUCT_VISION.md` — what the platform is and does
