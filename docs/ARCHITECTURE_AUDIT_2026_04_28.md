# CVC Intelligence — Architecture Audit
**Date:** 2026-04-28
**Purpose:** Pre-migration reference. Complete snapshot of the platform as-is. Do not modify this file — create a new audit when the next review is done.

---

## 1. API Routes

All routes registered in `api/main.py` with prefixes. HTTP Basic Auth on all routes except `/health`, `/app`, and static assets.

| Prefix | File | Purpose |
|--------|------|---------|
| `/companies` | routes/companies.py | Core company CRUD, activity log, intel, intros, commercial deployments, funding rounds |
| `/portfolio` | routes/portfolio.py | Portfolio list + stats (is_portfolio=TRUE companies) |
| `/sourcing` | routes/sourcing.py | Advanced company search with scoring filters |
| `/dealflow` | routes/dealflow.py | Deal pipeline, term sheets |
| `/partners` | routes/partners.py | Partner CRM — list, detail, documents, contacts, problems, signals |
| `/lp` | routes/lp.py | LP reporting — fund metrics, NAV history, annual reports, sector exposure |
| `/intelligence` | routes/intelligence.py | LLM usage tracking, trend reports, RSS source management, cron job toggle |
| `/industrial` | routes/industrial.py | Industrial readiness matrix |
| `/trends` | routes/trends.py | Quarterly trend dashboard (trend_report schema) |
| `/tasks` | routes/tasks.py | Task queue — create, approve, feedback |
| `/shortlists` | routes/shortlists.py | Curated company lists |
| `/home` | routes/home.py | Dashboard widgets, team messages, leaderboards, briefing insights |
| `/admin` | routes/enrichment.py | Batch enrichment jobs, Brave Search, activity log, quickadd, DD pipeline trigger |
| `/review` | routes/review.py | Chrome extension match/decision/evidence endpoints |
| `/brambles` | routes/brambles.py | Brambles advisory pipeline — enrichment, feedback, memo generation |

---

## 2. Workers

### Enrichment (`workers/enrichment/`)
| Script | Trigger | Cron Gate | Machine |
|--------|---------|-----------|---------|
| enrich_worker.py | Batch API or cron 2AM UTC | "Company Enrichment — Phase 1" | Dell |
| enrich_phase2.py | Batch API or cron 2:30AM UTC | "Company Enrichment — Phase 2" | Dell |
| enrich_deep.py | Batch API | none | Dell |
| enrich_funding_rounds.py | Batch API | none | Dell |
| enrich_industrial.py | Batch API | none | Dell |
| founder_research.py | Batch API | none | Dell |
| process_intel.py | API "Save & Process" button or manual | none | Dell |
| batch_enrichment.py | Spawned as subprocess by admin.py | n/a | Dell |
| score_refresh.py | Batch API or cron 3AM UTC | "Scoring Refresh" | Dell |

### Briefing (`workers/briefing/`)
| Script | Trigger | Machine |
|--------|---------|---------|
| enrichment_worker.py | Cron 4:30AM UTC daily | **Refinery** (RTX 3090) |
| fetch_podcasts.py | Called by enrichment_worker | Refinery |
| diarize_podcast.py | Called by fetch_podcasts | Refinery |
| weekly_briefing.py | Cron Sunday 5AM UTC | Dell |
| strategic_matcher_worker.py | Called by enrichment_worker | Refinery |
| entity_resolver.py | Called by enrichment_worker | Refinery |
| weekly_signals.py | Cron Sunday 6AM UTC | Dell |
| weekly_delta.py | Called by weekly_briefing | Dell |

### DD Pipeline (`workers/dd/`)
| Script | Trigger |
|--------|---------|
| run_three.py | API `POST /admin/dd/{id}/trigger` or manual |
| agents/* (8 specialists) | Orchestrated by run_three.py |
| ingestion/ingest_local.py | Auto-runs when no manifest exists |
| ingestion/drive.py | Manual or triggered by ingest.py |
| scorecard.py | Called by format agent |
| forge.py | Manual (feedback learning) |

### Tasks (`workers/tasks/`)
| Script | Role |
|--------|------|
| task_publisher.py | Enriches task spec, writes to cvc.build_tasks |
| task_worker.py | Polls DB, executes low-risk tasks |
| task_worker_agent.py | Handles medium/high risk tasks, Telegram notifications |
| task_deployer.py | Deploys tasks as background daemons |

### Other
| Script | Trigger | Machine |
|--------|---------|---------|
| workers/trends/run_collectors.py | Cron | Dell |
| workers/monitoring/agent_usage_sync.py | Scheduled | Dell |
| workers/import/* | Manual only | Either |

---

## 3. Hardcoded Paths

| File | Path | Purpose |
|------|------|---------|
| api/routes/brambles.py:25 | `/home/nathan11/repos/brambles_dd_engine` | Brambles scoring engine import |
| api/routes/brambles.py:656 | `/home/nathan11/repos/cvc-intelligence/api/static/brambles` | Brambles output files |
| workers/dd/config/settings.py | `~/.producer/gdrive_credentials.json` | Google Drive OAuth |
| workers/dd/config/settings.py | `~/.producer/gdrive_token.json` | Google Drive token cache |
| core/cvc_config.py:37 | `~/.cvc-skills/metrics.db` | SQLite metrics DB |
| workers/dd/config/settings.py | `REPO_DIR / "workdir"` | DD workdir (relative, safe) |
| api/routes/enrichment.py:30 | `_REPO_ROOT / "workers/dd/workdir"` | DD workdir (relative, safe) |

---

## 4. Configuration Sources

| Source | What It Contains | Where Used |
|--------|-----------------|------------|
| Environment variables | API keys, DB credentials, Telegram tokens | All workers + API |
| `.env` file (Dell) | OPENROUTER_API_KEY and others | Loaded at startup |
| `config/team_credentials.json` | HTTP Basic Auth username:password pairs | api/auth.py |
| `cvc.platform_settings` (DB) | investment_thesis, sector_focus, analyst_context, corporate_partners_context, brambles_agent_learning | workers + ConfigLoader singleton |
| Hardcoded defaults | DB host/port/user/pass, Ollama URL, LLM model names | core/db/connection.py, dd/config/settings.py |
| `~/.producer/gdrive_*.json` | Google Drive OAuth | workers/dd/ingestion/drive.py |

**DB defaults (fallback if env not set):**
- host: 100.83.104.117, port: 5432, dbname: cvc_db, user: producer, password: CVC_DB_PASSWORD

---

## 5. External Dependencies

| Service | Keys Stored In | Used For | Quota/Cost |
|---------|---------------|----------|------------|
| OpenRouter | `OPENROUTER_API_KEY` env | All LLM calls | Pay-per-use, tracked in llm_usage_log |
| Brave Search | `BRAVE_SEARCH_KEY`, `BRAVE_SEARCH_KEY_BACKUP` env | Company/funding research | ~2000/mo tracked in brave_search_log |
| Proxycurl | `PROXYCURL_API_KEY` env | LinkedIn founder research | Pay-per-use |
| OpenAI | `OPENAI_API_KEY` env | Embeddings (text-embedding-3-small) | Pay-per-use |
| Google Drive | `~/.producer/gdrive_*.json` | DD dataroom ingestion | Free (OAuth) |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` env | Worker notifications | Free |
| Ollama | localhost:11434 (no key) | Local LLM fallback | Free, Refinery GPU |
| YouTube oEmbed | None | Auto-fetch video titles | Free |

**LLM Models in use:**
- `qwen/qwen3-235b-a22b-2507` — default enrichment, DD, briefing
- `moonshotai/kimi-k2.5` — weekly briefing, audit
- `google/gemini-2.0-flash-001` — long-context financials (DD)
- `qwen3:30b-a3b` — Refinery Ollama (briefing enrichment)

---

## 6. Database Tables (cvc schema)

| Table | Purpose | Notable Columns |
|-------|---------|-----------------|
| companies | Core company records (~1,700+) | embedding (1536-dim vector), tags/investors (text[]), score_* fields, 4D fields, fund, is_portfolio |
| company_activity_log | Every manual field edit | changed_by, field_name, old/new_value, change_source |
| company_lifecycle | Stage transition history | status, transitioned_at |
| company_intel | Attached research/articles | processed bool, llm_summary |
| commercial_deployments | Live customer deployments | stealth bool, deployment_type, contract_value_usd |
| company_robotics | Robotics capability matrix | hardware/software flags, protocol support |
| funding_rounds | Funding history | round_type, amount_usd, valuation_usd, investors text[] |
| intel_suggestions | AI-suggested company data edits | suggestion_type, suggested_data jsonb, status |
| entities | Named entities from signals | company_id FK (nullable), match_confidence |
| verification_evidence | Chrome extension review records | screenshot bytea, decision |
| term_sheets | Investment records | fund, check_size_usd, is_written_off, UNIQUE(company_id, fund) |
| term_sheet_followons | Follow-on investment records | company_id, amount_usd, close_date |
| fund_metrics | Fund-level KPIs | deployed_capital, nav, tvpi, fund_size_usd |
| fund_nav_history | Monthly NAV for TVPI chart | nav_usd, tvpi, fund, snapshot_date |
| dd_evaluations | DD pipeline outputs | ic_memo_json (large jsonb), status |
| dd_feedback | Analyst corrections on DD findings | section, verdict, note |
| build_tasks | BigBossHog task queue | task_type, status, spec, risk_level |
| batch_jobs | Enrichment batch job records | progress_current/total, results_summary jsonb |
| partners | Partner CRM records | tech_stack jsonb, name_embedding (vector) |
| partner_documents | Partner uploaded files | **672MB+**, file_data bytea, extracted_intel jsonb |
| partner_intros | Startup introductions | intro_date, delivered_date, receiver |
| partner_problems | Partner issue kanban | status, confidence_score, kpi |
| partner_issues | Structured issue tracker | severity, resolved bool |
| partner_issue_comments | Issue thread comments | — |
| partner_advisory_logs | Advisory engagement log | — |
| content_items | Ingested podcasts/articles | raw_text (large), podcast_synthesis jsonb |
| briefing_insights | Weekly briefing outputs | source_type (podcast/news/partner_signal/article) |
| llm_usage_log | LLM API cost tracking | activity, model, cost, tokens |
| brave_search_log | Brave Search usage | company_id, search_type, result_count |
| brave_search_templates | Saved query templates | — |
| cron_jobs | Worker enable/disable gates | name, active bool, schedule |
| platform_settings | Global config KV store | key (unique), value text |
| agent_memory | Agent persistent memory | agent_name, content, created_at |
| home_team_messages | Team announcements | pinned bool, posted_by |
| shortlists | Curated company lists | — |
| shortlist_companies | Junction table | — |
| signal_dismissals | Dismissed partner signal matches | partner_id + content_item_id PK |
| raw_signals (trend_report schema) | Weekly market signals | sector_tags[], signal_type, quarter |
| brambles_pipeline | Brambles advisory projects | ic_memo_json, review_memo_json, enrichment_status |
| brambles_feedback | Analyst verdicts per claim | section, verdict, note |

**Current migration level:** 082 (`core/db/migrations/082_fund_i_lp_schema.sql`)

---

## 7. Data on Disk (Not in DB)

| Location | What | Size Est. | Owner |
|----------|------|-----------|-------|
| `api/static/app/` | React SPA build output | ~2MB | git-committed |
| `api/static/brambles/{id}/` | Brambles review memos (HTML) | Small | API process |
| `workers/dd/workdir/{company}/` | DD report artifacts (JSON, PDF, XLSX) | Grows with each run | DD pipeline |
| `~/.producer/gdrive_credentials.json` | Google Drive OAuth client secret | Tiny | Manual |
| `~/.producer/gdrive_token.json` | Google Drive token cache | Tiny | Auto-refreshed |
| `~/.cvc-skills/metrics.db` | SQLite LLM metrics | Small | Workers |
| `config/team_credentials.json` | HTTP Basic Auth passwords | Tiny | Manual |
| `chrome-extension/` | Browser extension source | Small | git-committed |

---

## 8. Authentication

- **Type:** HTTP Basic Auth
- **Credentials:** `config/team_credentials.json` (gitignored, created manually on server)
- **Implementation:** `api/auth.py` — `secrets.compare_digest()` for timing-safe comparison
- **Scope:** All API routes. React app passes auth header on every fetch.
- **No:** JWT, sessions, OAuth, RBAC, MFA, token rotation

---

## 9. Deployment

```
Developer edits code on Refinery
  → git push origin main
  → ssh nathan11@100.83.104.117 "bash ~/scripts/update_api.sh"
     → git pull origin main (on Dell)
     → verify 12 API health checks
     → systemd restart (or manual uvicorn restart)
```

- **No CI/CD** — no GitHub Actions, no Docker, no IaC
- **React build** — must be run manually: `cd designs/figma-dashboard && npm run build`
- **Build artifacts committed to git** — `api/static/app/` is in version control
- **No rollback mechanism** beyond `git revert` + redeploy
- **Workers** — started manually or by cron; no supervisor/systemd per-worker

---

## 10. Known Technical Debt (Prioritized)

### High — Will cause problems as data grows
1. **`partner_documents.file_data` bytea** — 672MB and growing in PostgreSQL. Should be object storage (MinIO/S3).
2. **`content_items.raw_text`** — Podcast transcripts stored as large text in DB. Same problem.
3. **React build assets committed to git** — Bloats repo history, slows clones.

### Medium — Fragile or unscalable
4. **HTTP Basic Auth** — No token rotation, no RBAC, credentials in a JSON file.
5. **Hardcoded DB credentials** as fallback defaults in `core/db/connection.py`.
6. **No connection pooling** beyond psycopg2 — each worker opens its own connections.
7. **Workers have no retry logic** — a failed enrichment run is silent unless logs checked.
8. **Single machine, no failover** — Dell goes down, everything goes down.

### Low — Cleanup / housekeeping
9. **`api/static/app/` in git** — Move to build-time artifact, not version-controlled.
10. **`~/.cvc-skills/metrics.db` SQLite** — Redundant with `cvc.llm_usage_log` in PostgreSQL.
11. **Hardcoded `nathan11` user paths** in brambles.py — breaks if user changes.
12. **No database migration runner** — migrations are SQL files run manually.
13. **Dead files on disk** — resolved in current cleanup pass.

---

## 11. Rebuild Checklist (If Server Lost)

1. PostgreSQL restore from backup (`~/scripts/backup_db.sh` rsync to Refinery)
2. Clone repo: `git clone https://github.com/natelouie11-tech/NEW-CVC-REPO cvc-intelligence`
3. Create `config/team_credentials.json` manually
4. Set env vars: OPENROUTER_API_KEY, BRAVE_SEARCH_KEY, BRAVE_SEARCH_KEY_BACKUP, PROXYCURL_API_KEY, OPENAI_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
5. Restore `~/.producer/gdrive_credentials.json` (from secure backup)
6. Install Python deps: `pip install -r requirements.txt` in venv
7. Install Node deps + build React: `cd designs/figma-dashboard && npm install && npm run build`
8. Start API: `uvicorn api.main:app --host 0.0.0.0 --port 8001`
9. Set up cron jobs (see CLAUDE.md for schedule)
10. Re-sideload Chrome extension
