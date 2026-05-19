# INFRASTRUCTURE.md — CVC Server Setup & Migration History

---

## Current State (as of 2026-04-05)

### Machines

| Machine | Hostname | IP | Role | User | OS | Cores | RAM |
|---|---|---|---|---|---|---|---|
| Dell R620 (basement) | nlouserv | 100.83.104.117 | Everything | nathan11 | Ubuntu 24.04 | 24 | 96GB |
| Refinery/WSL | — | 100.114.250.70 | Ollama only | nathan | WSL2/Windows | — | — |
| Lenovo (Whip Claw) | — | 100.74.101.77 | Memory/monitoring | User | WSL2/Windows | — | — |

### Dell Server — What's Running

| Service | How to check | Logs |
|---|---|---|
| CVC Intelligence API (port 8001) | `ps aux \| grep uvicorn` | `~/logs/cvc-api.log` |
| task_deployer.py | `ps aux \| grep task_deployer` | `~/logs/task_deployer.log` |
| task_worker.py | `ps aux \| grep task_worker.py` | `~/logs/task_worker.log` |
| task_worker_agent.py | `ps aux \| grep task_worker_agent` | `~/logs/task_agent.log` |
| PostgreSQL (port 5432) | `pg_isready -h localhost` | system journal |
| BigBossHog (OpenClaw) | `ps aux \| grep openclaw` | `~/.openclaw/workspace/` |
| Big Claw (OpenClaw) | `ps aux \| grep openclaw` | `~/.openclaw-bigclaw/workspace/` |

### Dell Server — Key Paths

```
~/repos/cvc-intelligence/        — main repo (cloned from GitHub)
~/repos/cvc-intelligence/venv/   — Python venv (fastapi, uvicorn, psycopg2, etc.)
~/repos/cvc-intelligence/.env    — env vars (CVC_DB_HOST=localhost, OPENROUTER_API_KEY, etc.)
~/scripts/start_api.sh           — start/restart uvicorn
~/scripts/update_api.sh          — git pull from GitHub + restart (what task_deployer calls)
~/scripts/bbh_daily_log.sh       — BigBossHog idle log (cron 11PM UTC)
~/logs/                          — all service logs
~/.openclaw/workspace/           — BigBossHog agent workspace
~/.openclaw-bigclaw/workspace/   — Big Claw agent workspace
```

### Dell Server — Cron Jobs

```
0 2 * * *    enrich_worker.py     — Phase 1 enrichment (200 companies)
30 2 * * *   enrich_phase2.py     — Phase 2 enrichment (patents, funding)
0 3 * * *    score_refresh.py     — Scoring refresh
0 4 * * *    backup_db.sh         — pg_dump cvc_db → ~/backups/, rsync to Refinery ~/db_backups/, 7-day retention
0 6 * * 0    weekly_signals.py    — Sunday signals scraper
0 23 * * *   bbh_daily_log.sh     — BigBossHog idle log
*/5 * * * *  API watchdog         — restart uvicorn if down
```

### Refinery — What's Running

Only Ollama. Nothing else.

```
Ollama: http://100.114.250.70:11434
Models: qwen3:32b, qwen3.5:27b, deepseek-r1:32b
```

### Database

```
On Dell server:    host=localhost, port=5432
From anywhere:     host=100.83.104.117, port=5432
DB:                cvc_db
User:              producer / CVC_DB_PASSWORD
```

Schemas: `cvc.*` (13 tables), `trend_report.*` (6 tables), `public.*` (40 tables)
pgvector extension installed (required for cvc.companies embedding column).

### Deploy Flow

```
1. Big Claw commits to GitHub (natelouie11-tech/NEW-CVC-REPO)
2. task_deployer.py on Dell server detects a complete build task
3. Runs ~/scripts/update_api.sh:
   - git pull origin main   (local on Dell server — no Refinery relay)
   - restart uvicorn
4. Smoke test → Telegram notify
5. On failure: auto-revert commit, retry up to 2x, then escalate to Nate
```

### SSH Config (Dell server ~/.ssh/config)

```
Host refinery     → 100.114.250.70, user: nathan
Host whipclaw     → 100.74.101.77, user: User
Host droplet      → 100.95.2.44, user: root   (decommissioned — kept for reference)
```

### SSH Config (Refinery ~/.ssh/config — unchanged)

Scripts on Refinery SSH to Dell server directly using `nathan11@100.83.104.117`.

---

## Migration History

### 2026-04-05 — Droplet → Dell R620

**Reason:** DigitalOcean Droplet (100.95.2.44) replaced by Dell R620 server in Nate's basement.
Cost savings + local control + more resources.

**What moved:**
- PostgreSQL `cvc_db` — full dump/restore, all 59 tables, all data verified
- CVC Intelligence API (uvicorn port 8001)
- task_deployer.py, task_worker.py, task_worker_agent.py
- All 6 cron jobs
- BigBossHog and Big Claw OpenClaw gateways

**What stayed:**
- Refinery: Ollama only. No other services.
- Whip Claw (Lenovo): unchanged.
- Real Claw (Oracle Cloud): unchanged, separate project.

**Code changes (all committed to this repo):**
- `core/db/connection.py`: default host `100.95.2.44` → `100.83.104.117`
- `workers/tasks/task_deployer.py`: revert now runs locally (was SSH to Refinery); DEPLOY_SCRIPT path updated
- `workers/tasks/task_worker.py` / `task_worker_agent.py`: headers updated
- `workers/enrichment/enrich_phase2.py`: PYTHONPATH in docstring updated
- `requirements.txt`: added `fastapi` and `uvicorn` (were missing, installed separately on old Droplet)
- `CLAUDE.md`: full rewrite for Dell server architecture
- `docs/AGENT_ECOSYSTEM.md`: rewritten
- `docs/INFRASTRUCTURE.md`: created (this file)

**Scripts updated (Refinery ~/scripts/ — not in this repo):**
- `daily_briefing.sh` — SSH targets, DB host, workspace paths
- `refresh_context.sh` — same
- `sync_collective.sh` — push targets
- `sync_agent_configs.sh` — pull sources
- `sync_desktop.sh` — rsync sources, DB host
- `dd_transfer.sh` — transfer target, run command paths
- `bigclaw_daily_log.sh` — DB host
- `mem_write.py`, `mem_collective.py` — DB host

**DB documented:** Migration event written to `cvc.agent_memory` for bigbosshog, bigclaw, and whipclaw on 2026-04-05.

**Verification:** 59 tables, all row counts matched. API health `{"status":"ok"}`. All 3 workers confirmed polling.

**Droplet status after migration (2026-04-06: fully cleared):**
- All CVC processes stopped: openclaw-gateway, uvicorn api.main, task workers
- All legacy processes stopped: producer.service (port 8000), dataset-discovery, refinery-upload, dashboard/app.py
- Crontab: cleared
- PostgreSQL: left running as read-only backup — decommission target 2026-04-13
- Backup added on Dell server: backup_db.sh daily at 4AM UTC, rsyncs to Refinery ~/db_backups/

---

## pgvector

The `cvc.companies` and related tables use `vector` columns for embeddings.
pgvector must be installed on any machine running PostgreSQL for this DB.

**Install:** `sudo apt-get install -y postgresql-16-pgvector`
**Then in psql:** `CREATE EXTENSION IF NOT EXISTS vector;`

This was a required step during the Dell server migration.

---

## Python Environment

No system-wide pip on Ubuntu 24.04 by default. Bootstrapped using:

```bash
curl -sS https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py
python3 /tmp/get-pip.py --break-system-packages
python3 -m pip install --break-system-packages virtualenv
~/.local/bin/virtualenv ~/repos/cvc-intelligence/venv
venv/bin/pip install -r requirements.txt
```

PYTHONPATH must be set to `~/repos/cvc-intelligence/core` for all workers and the API.
This is set in the venv activation, `.env`, and all cron jobs explicitly.

---

## Node.js / OpenClaw

Node.js 22 installed via nodesource apt (system-wide, requires sudo):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g openclaw
```

**Installed version:** OpenClaw 2026.4.5 (3e72c03), Node.js 22.22.2

**npm global prefix:** `~/.npm-global/bin` — ensure this is in PATH for cron and non-interactive shells.

**nvm conflict note:** nvm was previously installed and set a `prefix` in `~/.npmrc`, which conflicts with the npm global prefix above. If you see `nvm use --delete-prefix` warnings, run:
```bash
nvm use --delete-prefix v22.22.2 --silent
```
