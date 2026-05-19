# Orientation Doc — Post-Recovery (Apr 17, 2026)

## Where We Are

CVC Intelligence Platform is live on the **Dell R620 server** (100.83.104.117, nathan11). 
**1,723 companies** in the database. **77 tasks deployed**, 9 complete, 12 pending.

### Infrastructure
- **Dell R620 (100.83.104.117):** API (port 8001), PostgreSQL, BigBossHog, Big Claw, Sharp Claw — ALL on this machine
- **Refinery (100.114.250.70):** Ollama only — no workers, no agents. Dev machine for Claude Code.
- **Whip Claw (100.74.101.77):** Lenovo WSL — documentation/QA watchdog
- **DigitalOcean Droplet:** DECOMMISSIONED. Do not reference it.

### Key Files to Read First
1. **`~/repos/cvc-intelligence/api/main.py`** — FastAPI app, all route registrations
2. **`~/repos/cvc-intelligence/api/routes/`** — 16 route files (companies, partners, admin, enrichment, intelligence, trends, sourcing, shortlists, lp-portal, etc.)
3. **`designs/figma-dashboard/src/app/routes.tsx`** — React router config (all pages)
4. **`designs/figma-dashboard/src/app/pages/`** — All React page components
5. **`core/db/connection.py`** — DB connection (RealDictCursor — rows are dicts, use `row['col']` not `row[0]`)
6. **`workers/`** — All workers (enrichment, scoring, scrapers, tasks, dd, briefing)

### What Was Built (Apr 9–17)
**Company Profile:**
- Funding History: equity vs non-dilutive tracks, inline edit, total raised hero
- Commercial Deployment section
- Founder Research enrichment + worker + exit track record
- Collapsible sections (4D, Funding, Industrial Analysis)
- Structured founder fields (founders, is_repeat_founder, prior_exit_count)
- Process Intel button + Add/Delete funding rounds

**Enrichment Page:**
- Redesigned: left sidebar + Human Review queue
- Quick Add URL card
- Funding & Commercial, News & Case Studies tiles
- Step-by-step pipeline tiles
- Enrichment coverage dashboard + daily snapshot worker
- Batch enrichment control panel (Admin page)

**Admin & Navigation:**
- Task Queue merged into Admin page
- LP Portal → tab on Portfolio page
- Master Activity Log — staff engagement tracking
- Sector definition panels on Industrial Intelligence page
- Deal Flow: term sheet panel

**Backend:**
- BigBossHog enriches task specs before Big Claw builds
- Funding suggestion merges instead of duplicating
- `--founders` flag, `--sector` flag on workers
- Intel intent/direction tags for LLM extraction
- Commercial deployments table (migration 055)
- Term sheets table (migration 058)

### Important Conventions
- **DictCursor:** Always `row['column_name']`, never `row[0]`
- **Import paths:** `from core.db.connection import get_connection` (not `from db.connection`)
- **PYTHONPATH:** Always `~/repos/cvc-intelligence/core`
- **Never** `git add`, `git commit`, `git push` from the server — Big Claw owns commits
- **Always** `git pull origin main` before starting work

### Current Pending Tasks (check cvc.build_tasks)
```bash
PGPASSWORD="$CVC_DB_PASSWORD" psql -h localhost -U producer -d cvc_db -c "SELECT task_id, status, LEFT(spec,60) FROM cvc.build_tasks WHERE status IN ('approved','pending','complete','building') ORDER BY task_id;"
```

### API Health
```bash
curl -s http://localhost:8001/health
# If down: ~/scripts/start_api.sh
```

### Log Files
```
~/logs/cvc-api.log
~/logs/task_deployer.log
~/logs/task_worker.log
~/logs/task_agent.log
~/logs/cvc_enrichment.log
~/logs/cvc_scoring.log
```
