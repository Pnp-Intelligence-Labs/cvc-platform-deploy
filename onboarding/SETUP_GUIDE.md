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

A sample file is at `onboarding/sample_companies.csv`. Use it as a template or to test the import flow.

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

Some features use external APIs. None are required to run the platform —
the core product works without them. They unlock specific AI-powered features.

### OpenRouter (`OPENROUTER_API_KEY`)

**What it is:** A single API that routes requests to any major AI model
(Claude, GPT-4, Gemini, Llama, etc.). You pick the model; you pay per use.

**What it unlocks in this platform:**

| Feature | What happens |
|---|---|
| Quick-add by URL | Paste a company URL → AI reads the site and pre-fills the company card (name, sector, one-liner, stage, headcount) |
| Trend Reports plugin | AI drafts venture intelligence reports from your pipeline data and signals |
| Intelligence Feed plugin | AI summarizes podcast transcripts and research papers into weekly briefings |

**What happens without it:** Those specific actions fall back to manual entry.
Everything else — the full company database, partners, pipeline, admin — works fine.

**Cost:** You're billed per AI call, not per seat. A typical quick-add costs roughly
$0.002–0.01 depending on which model you choose. A full trend report is $0.05–0.20.
Most teams spend $5–20/month total.

**How to get it:**
1. Go to [openrouter.ai](https://openrouter.ai) and create an account
2. Add a credit card and load a small amount (e.g. $10 to start)
3. Go to **Keys** → **Create Key**
4. Paste it into `.env` as `OPENROUTER_API_KEY=sk-or-...`

**Which model to use:** The platform defaults to a fast, cheap model for enrichment
and a more capable model for reports. You can override this in `.env`:
```env
OPENROUTER_DEFAULT_MODEL=anthropic/claude-3-haiku   # fast + cheap (enrichment)
OPENROUTER_REPORT_MODEL=anthropic/claude-3-5-sonnet  # capable (reports)
```
If you don't set these, the platform picks sensible defaults.

---

### Brave Search (`BRAVE_API_KEY`)

**What it is:** A web search API. Brave offers a free tier (2,000 searches/month)
and paid tiers beyond that.

**What it unlocks:** Company news tracking in the News Feed plugin — the background
worker searches for recent news about your watched companies and stores the results.

**What happens without it:** The News Feed plugin still installs and the UI still
loads, but the news fetch worker won't find new articles.

**How to get it:**
1. Go to [api.search.brave.com](https://api.search.brave.com)
2. Create an account → **Create App** → copy the API key
3. Paste into `.env` as `BRAVE_API_KEY=BSA...`

The free tier is enough for most teams (up to ~60 companies watched).

---

### Proxycurl (`PROXYCURL_API_KEY`)

**What it is:** A LinkedIn data API — pulls founder and executive profiles
from LinkedIn URLs without scraping.

**What it unlocks:** Founder LinkedIn enrichment in the DD pipeline worker.
When you run enrichment on a company, Proxycurl fills in founder background,
previous companies, and education.

**What happens without it:** The enrichment worker skips the LinkedIn step.
All other enrichment (website, sector, stage, description) still runs.

**How to get it:**
1. Go to [nubela.co/proxycurl](https://nubela.co/proxycurl)
2. Create an account — they offer a free trial (10 credits)
3. Paste into `.env` as `PROXYCURL_API_KEY=...`

Proxycurl is optional even if you're running enrichment. Start without it.

---

After editing `.env`, restart the API for changes to take effect:
```bash
# If running via systemd:
sudo systemctl restart platform-api

# If running manually:
# Stop the process and re-run: bash scripts/run_local.sh
```

---

## Step 8 — Plugins

The installer already prompted you to install plugins. If you want to add or remove one later:

**Install a plugin:**
```bash
cp -r plugins/_staging/packages/<slug> plugins/installed/<slug>
# Run the plugin's migrations (creates any plugin-specific DB tables)
bash scripts/migrate.sh
# Restart the API — it reads installed/ at startup and caches it
pkill -f "uvicorn api.main" && bash scripts/run_local.sh
```

**Remove a plugin:**
```bash
rm -rf plugins/installed/<slug>
# Restart the API (plugin tables are left in the DB — no data loss)
pkill -f "uvicorn api.main" && bash scripts/run_local.sh
```

> **Important — API restart always required.** The platform loads plugin manifests once at startup and caches them. Any change to a plugin (install, remove, or editing a manifest) requires an API restart before it takes effect. A hard browser refresh alone is not enough.

**Plugins ship with `nav: null` by default.** Installing a plugin does not automatically add it to the navigation bar. The plugin's API routes are active and its data is available, but the nav entry is off. To surface a plugin in the nav, edit its `manifest.json` in `plugins/installed/<slug>/` and set the `nav` field, then restart the API. This is intentional — it lets you install and configure a plugin before making it visible to your team.

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

**4. Put it behind a reverse proxy (required for production):**

Use nginx or Caddy to terminate TLS and proxy to port 8002.
Working example configs are in `infra/tls/`:

- **Caddy** (recommended — auto-HTTPS via Let's Encrypt):
  ```bash
  sudo cp infra/tls/Caddyfile.example /etc/caddy/Caddyfile
  # Edit: replace your-domain.com with your actual domain
  sudo systemctl reload caddy
  ```

- **nginx** (manual cert with certbot):
  ```bash
  sudo cp infra/tls/nginx.conf.example /etc/nginx/sites-available/platform
  sudo ln -s /etc/nginx/sites-available/platform /etc/nginx/sites-enabled/
  sudo certbot --nginx -d your-domain.com
  sudo systemctl reload nginx
  ```

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

**Onboarding docs:**
- `onboarding/USER_GUIDE.md` — end-user guide (share with your team)
- `onboarding/GOLIVE_CHECKLIST.md` — security + ops checklist before going live
- `onboarding/DATA_MIGRATION.md` — how to export from Airtable, Notion, Excel
- `onboarding/TEAM_INVITE.md` — copy-paste templates for inviting your team
- `onboarding/sample_companies.csv` — companies CSV template
- `onboarding/sample_partners.csv` — partners CSV template

**Technical docs:**
- `docs/DECISIONS.md` — architecture decisions
- `docs/PLUGIN_INTERFACE.md` — how to build a plugin
- `PRODUCT_VISION.md` — product vision and design principles
