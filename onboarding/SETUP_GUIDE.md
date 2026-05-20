# Vertical OS — New Team Setup Guide

Everything a new team needs to go from zero to a running deployment.
Estimated time: 30–45 minutes.

---

## What You're Installing

A self-hosted internal operations platform for your ventures team.
It runs on your own server — your data never leaves your infrastructure.

**Core platform includes:** Ventures (deal flow + company database),
Partners (CRM), Sales Pipeline, Requests, Quick Notes, Homepage dashboard.

**Optional plugins** (LP Portal, DD Pipeline, Intelligence Feed, etc.)
are installed separately after the base platform is running.

---

## Prerequisites

You need a Linux server (Ubuntu 22.04+ recommended) with:

| Requirement | Min Version | Install |
|---|---|---|
| Docker | 24+ | [docs.docker.com](https://docs.docker.com/engine/install/) |
| Docker Compose | 2.20+ | Included with Docker Desktop |
| Python | 3.10+ | `apt install python3 python3-venv` |
| Node.js | 18+ | [nodejs.org](https://nodejs.org/) |
| psql client | 14+ | `apt install postgresql-client` |
| Git | any | `apt install git` |

The server needs outbound internet access for API key calls (OpenRouter, Brave Search).
Inbound: only your team needs to reach it — a firewall or VPN is fine.

---

## Step 1 — Clone the Repo

```bash
git clone https://github.com/natelouie11-tech/cvc-platform-deploy.git
cd cvc-platform-deploy
```

---

## Step 2 — Run the Installer

```bash
bash scripts/install.sh
```

The installer will:
1. Check that all dependencies are installed
2. Generate a `.env` file with a random JWT secret and DB password
3. Prompt you for your team name, sectors, and fund name
4. Build the React frontend
5. Start a PostgreSQL Docker container
6. Create a Python virtualenv and install dependencies
7. Run all database migrations
8. Prompt you to install optional plugins (Y/n per plugin)

**When it asks for team details:**
- **Team name**: your firm's full name (e.g. "Acme Ventures")
- **Short name**: abbreviation for display (e.g. "Acme")
- **Logo character**: single letter shown in the nav bar (e.g. "A")
- **Fund name**: your primary fund name (e.g. "Fund I")
- **Sectors**: comma-separated focus areas (e.g. "SaaS, Fintech, Deep Tech")

These are written to `config/team.json`. You can edit this file anytime
to add more funds, update sectors, or change branding — no code changes needed.

---

## Step 3 — Start the Platform

**API (backend):**
```bash
bash scripts/run_local.sh
```
This starts the API on port 8002. Leave it running in a terminal.

**Frontend (for local dev / first-time setup):**
```bash
cd designs/figma-dashboard
npm install
npm run dev
```
The frontend runs on port 5173. Open `http://localhost:5173` in your browser.

For production, build the frontend once and serve it via the API:
```bash
npm run build
# Built files go to api/static/app/ — served at http://your-server:8002/app
```

---

## Step 4 — First Login

Open the platform in your browser.

**Default credentials:** `admin` / `changeme`

**Change the admin password immediately:**
1. Log in as admin
2. Go to **Admin** → **Users**
3. Click your user → **Change Password**

---

## Step 5 — Add Your Team

Add a user account for each team member:

1. Go to **Admin** → **Users** → **Add User**
2. Set their role:

| Role | What they can do |
|---|---|
| **GP** | Everything — full admin access |
| **Principal / Director** | Everything except build configuration |
| **Ventures** | Companies, deal flow, DD, fund data |
| **PSM** | Their assigned partners only, no fund data |

3. For PSM users, assign them to their partners under **Admin** → **Partner Assignments**

Each user sets their own password on first login.

---

## Step 6 — Import Your Data

**Want to see the platform populated before importing real data?**
Load the demo dataset (30 companies, 4 partners, pipeline data):
```bash
python3 scripts/seed_demo.py
```
The installer offers this automatically — you can also run it anytime.
Demo data is clearly labelled (`enrichment_source = 'demo_seed'`) and can be
deleted at any time: `DELETE FROM cvc.companies WHERE enrichment_source = 'demo_seed';`

### Companies / Deal Flow

Import your existing pipeline via CSV (any spreadsheet export works):

```bash
curl -X POST http://localhost:8002/admin/companies/import \
  -H "Authorization: Bearer <your-token>" \
  -F "file=@your_companies.csv"
```

**Supported columns** (all optional except `name`):

| Column | Example |
|---|---|
| `name` | Acme Robotics |
| `website` | https://acmerobotics.com |
| `sector` | Robotics |
| `stage` | Series A |
| `hq_city` | Boston |
| `hq_country` | US |
| `founded` | 2021 |
| `employee_count` | 45 |
| `total_raised_usd` | 12000000 |
| `one_liner` | Autonomous warehouse robots |

Column names are case-insensitive. Existing companies (matched by name) are skipped. The response includes `inserted`, `skipped`, and `failed` counts.

After import, set `enrichment_status = 'pending'` and the overnight enrichment worker will fill in missing fields automatically.

Or add companies one at a time via **Ventures** → **Add Company** → quick-add by URL.

### Partners

Go to **Partners** → **Add Partner** to build your partner CRM.

---

## Step 7 — Configure API Keys (Optional)

Some features require external API keys. Set these in your `.env` file:

| Key | Feature | Where to get it |
|---|---|---|
| `OPENROUTER_API_KEY` | AI enrichment, partner analysis | openrouter.ai |
| `BRAVE_API_KEY` | Company research, news signals | api.search.brave.com |
| `PROXYCURL_API_KEY` | Founder LinkedIn data | nubela.co/proxycurl |

After editing `.env`, restart the API for changes to take effect.

---

## Step 8 — Plugins

The installer already prompted you to install plugins. If you want to add or remove one later:

**Install a plugin:**
```bash
cp -r plugins/_staging/packages/<slug> plugins/installed/<slug>
# Run the plugin's migrations (creates any plugin-specific DB tables)
bash scripts/migrate.sh
# Then restart the API — it auto-discovers installed/ at startup
```

**Remove a plugin:**
```bash
rm -rf plugins/installed/<slug>
# Restart the API (plugin tables are left in the DB — no data loss)
```

**Available plugins** (all included in the repo under `plugins/_staging/packages/`):

| Plugin | Slug | What it adds |
|---|---|---|
| Enrichment Queue | `enrichment` | Company enrichment pipeline, DD workflow, quickadd by URL |
| Industrial Matrix | `industrial-matrix` | Sector readiness scoring with configurable metrics |
| Intelligence Feed | `intelligence-feed` | Weekly briefing pipeline, podcast + research signals |
| LP Portal | `lp-portal` | Fund metrics and LP-facing reporting |
| News Feed | `news-feed` | Company news tracking via Brave Search |
| Trend Reports | `trend-reports` | AI-assisted venture intelligence report builder |

**Check plugin health after restart:**
```
GET /admin/plugins/health
```
Returns `healthy` or `degraded` per plugin (degraded = missing DB tables).

---

## Production Deployment (Server vs. Local Dev)

For a permanent deployment on a team server:

**1. Keep the API running persistently:**

```bash
# Create a systemd service
sudo tee /etc/systemd/system/platform-api.service > /dev/null <<EOF
[Unit]
Description=Vertical OS API
After=docker.service

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$(pwd)
ExecStart=$(pwd)/.venv/bin/uvicorn api.main:app --host 0.0.0.0 --port 8002
Restart=always
EnvironmentFile=$(pwd)/.env

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable platform-api
sudo systemctl start platform-api
```

**2. Build and serve the frontend from the API:**

```bash
cd designs/figma-dashboard && npm run build
# Copies to api/static/app/ automatically
# Access at: http://your-server:8002/app
```

**3. Set ALLOWED_ORIGINS in .env:**

```env
ALLOWED_ORIGINS=https://your-domain.com,http://your-server-ip:8002
```

**4. Put it behind a reverse proxy (recommended):**

Use nginx or Caddy to terminate TLS and proxy to port 8002.
This gives you HTTPS and hides the port number.

---

## Backup

The database is PostgreSQL running in Docker. Back it up with:

```bash
docker exec platform-db pg_dump -U platform platform_db | gzip > backup_$(date +%Y%m%d).sql.gz
```

Set this up as a cron job to run nightly.

---

## Verify Your Installation

After setup, run the smoke test to confirm the API and all core routes are working:

```bash
bash scripts/smoke_test.sh
```

With custom credentials or a remote server:
```bash
bash scripts/smoke_test.sh http://your-server:8002 admin yourpassword
```

The script checks: login, all core API routes, admin endpoints, plugin health, and
that data exists (companies + partners). Installed plugins are checked; uninstalled
plugins are skipped. Exits with code 0 (all pass) or 1 (any failure).

---

## Troubleshooting

**API won't start:** Check `.env` exists and has valid values. Run:
```bash
source .env && python3 -c "from api.main import app; print('OK')"
```

**Database connection error:** Make sure Docker is running and the
`platform-db` container is up: `docker ps | grep platform-db`

**Migrations failed:** Run them manually:
```bash
bash scripts/migrate.sh
```

**Frontend shows blank page:** Make sure the API is running on port 8002
and the `ALLOWED_ORIGINS` in `.env` includes your frontend URL.

**Plugin not loading:** Check `GET /admin/plugins/health` after restart.
Verify the plugin directory exists in `plugins/installed/<slug>/`.

---

## Getting Help

- **End-user guide** (for team members logging in): `onboarding/USER_GUIDE.md`
- Architecture decisions: `docs/DECISIONS.md`
- Plugin interface spec: `docs/PLUGIN_INTERFACE.md`
- Build plan history: `docs/PHASE1_BUILD_PLAN.md`
- Product vision: `PRODUCT_VISION.md`
