# Project Structure

**Plug and Play Vertical OS** — a self-hosted internal operations platform for venture capital teams.

> Run `bash scripts/run_local.sh` to start the API (port 8002) and `cd designs/figma-dashboard && npm run dev` for the frontend (port 5173).

---

## Root-Level Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Container build for the full API service |
| `docker-compose.yml` | Production compose stack (API + PostgreSQL) |
| `docker-compose.dev.yml` | Local dev compose override |
| `docker-compose.logging.yml` | Adds log aggregation sidecar |
| `requirements.txt` | Python dependencies (top-level, used by API) |
| `pyproject.toml` | Python project config + linting rules (ruff) |
| `uv.lock` | Locked dependency tree for uv |
| `conftest.py` | Pytest root fixtures (shared across all tests) |
| `playwright.config.ts` | E2E test config for Playwright |
| `package.json` | Root JS tooling (Playwright runner) |
| `.env` | Local secrets — never committed |
| `.env.example` | Template showing required env vars |
| `.gitignore` | Files excluded from git |
| `.dockerignore` | Files excluded from Docker builds |
| `.pre-commit-config.yaml` | Pre-commit hooks (gitleaks, ruff, etc.) |
| `.gitleaks.toml` | Secret scanning config |
| `.python-version` | Python version pin for pyenv/uv |
| `README.md` | Getting-started guide |
| `CLAUDE.md` | AI assistant instructions for this repo |
| `PRODUCT_VISION.md` | Platform product vision (deploy-repo version) |
| `ACTIVITY_LOG.md` | Chronological log of all changes made |
| `skills-lock.json` | Claude Code skills lockfile |

---

## Folder Tree

```
cvc-platform-deploy/
│
├── api/                        # FastAPI backend — runs on port 8002
│   ├── main.py                 # App entrypoint, mounts routes + middleware
│   ├── auth.py                 # JWT auth helpers, token validation
│   ├── plugin_loader.py        # Discovers and registers installed plugins
│   ├── middleware/             # Request pipeline middleware
│   │   ├── rate_limit.py       # Per-IP rate limiting
│   │   ├── request_logging.py  # Logs every inbound request
│   │   ├── security_headers.py # Adds HSTS, CSP, X-Frame-Options headers
│   │   ├── upload_validator.py # File type + size checks on uploads
│   │   └── ext_api_log.py      # Logs outbound calls to external APIs
│   ├── routes/                 # One file per feature area
│   │   ├── auth.py             # Login, logout, token refresh
│   │   ├── admin.py            # Admin panel endpoints
│   │   ├── companies.py        # Company database CRUD + search
│   │   ├── sourcing.py         # Sourcing pipeline + signal scoring
│   │   ├── dealflow.py         # Deal flow / pipeline tracking
│   │   ├── portfolio.py        # Portfolio companies + fund metrics
│   │   ├── partners.py         # Partner CRM endpoints
│   │   ├── terminal.py         # Partner terminal (market discovery, etc.)
│   │   ├── recommendations.py  # AI-powered company recommendations
│   │   ├── shortlists.py       # Curated company shortlists
│   │   ├── assignments.py      # PSM ↔ partner assignments
│   │   ├── requests.py         # Service request routing
│   │   ├── sales.py            # Sales pipeline endpoints
│   │   ├── meeting_notes.py    # Quick notes with context tagging
│   │   ├── notifications.py    # In-app notification delivery
│   │   ├── drive.py            # Google Drive per-user OAuth + browse
│   │   ├── home.py             # Homepage widget data
│   │   ├── mfa.py              # TOTP multi-factor auth
│   │   ├── config.py           # Runtime config reads
│   │   └── keycloak.py         # Keycloak SSO integration (optional)
│   └── static/                 # Files served directly by the API
│       ├── app/                # Built React SPA (output of `npm run build`)
│       ├── assets/             # Shared static assets
│       ├── avatars/            # User avatar images
│       ├── report_sources/     # DD report source files
│       ├── css/                # Global CSS (dashboard-theme.css)
│       └── pnp-slam-logo.png   # Platform logo
│
├── core/                       # Shared Python library — imported by api/ and workers/
│   ├── config.py               # Reads team.json + env vars into a config object
│   ├── config_loader.py        # Low-level config file parsing
│   ├── storage.py              # File storage abstraction (local / S3-compatible)
│   ├── notifications.py        # Notification dispatch (email, in-app)
│   ├── job_logger.py           # Structured job/task logging
│   ├── db/                     # Database layer
│   │   ├── connection.py       # PostgreSQL connection pool
│   │   ├── migrate.py          # Schema migration runner
│   │   ├── ingest.py           # Bulk data ingestion helpers
│   │   ├── enrich.py           # Enrichment pipeline DB helpers
│   │   ├── search.py           # Full-text + vector search queries
│   │   ├── migrations/         # SQL migration files (applied in order)
│   │   ├── docs/               # DB schema documentation
│   │   └── exports/            # Export query helpers
│   ├── drive/                  # Google Drive integration
│   │   ├── userauth.py         # Per-user OAuth token storage + refresh
│   │   ├── browse.py           # Drive file/folder listing
│   │   ├── pipeline.py         # Drive → DB ingestion pipeline
│   │   └── sense.py            # Content type detection for Drive files
│   ├── llm/                    # LLM client wrappers
│   │   └── openrouter.py       # OpenRouter API client (model routing)
│   ├── monitor/                # Usage monitoring
│   │   └── tracker.py          # Token + API call usage tracking
│   ├── pnpbert/                # PnPBERT embedding model
│   │   ├── engine.py           # Embedding inference engine
│   │   └── cache.py            # Embedding cache (avoids recomputation)
│   └── web/                    # Web data fetching
│       ├── brave.py            # Brave Search API client
│       ├── proxycurl.py        # ProxyCurl LinkedIn data client
│       ├── research.py         # Multi-source research pipeline
│       └── scrapling.py        # Web scraping helpers
│
├── designs/                    # Frontend source code
│   └── figma-dashboard/        # React SPA (Vite + Tailwind)
│       ├── src/                # Component source files
│       ├── public/             # Static public assets
│       ├── guidelines/         # Design guidelines / tokens
│       ├── index.html          # HTML entrypoint
│       ├── vite.config.ts      # Vite build config
│       ├── package.json        # Frontend dependencies
│       ├── DESIGN.md           # Design system decisions
│       └── ATTRIBUTIONS.md     # Third-party asset credits
│
├── workers/                    # Background workers — run independently of API
│   ├── batch_enrichment.py     # Runs enrichment pipeline on batches of companies
│   ├── import/                 # One-time data import scripts
│   │   ├── import_slam_2022_2023.py
│   │   ├── import_slam_2024.py
│   │   ├── import_slam_2025_intros.py
│   │   ├── import_slam_2026_intros.py
│   │   ├── import_pnp_engagement.py
│   │   └── import_ceo_contacts.py
│   ├── monitoring/             # System health workers
│   │   ├── watchdog.py         # Process/service health checks
│   │   └── agent_usage_sync.py # Syncs LLM usage stats to DB
│   ├── rm/                     # Relationship management workers
│   │   └── partner_contracts/  # Partner contract processing
│   └── tasks/                  # Task queue workers
│       └── task_worker.py      # Picks up and runs queued tasks from DB
│
├── plugins/                    # Plugin system — optional features installed separately
│   ├── installed/              # Active plugins (loaded by api/plugin_loader.py)
│   │   ├── data-explorer/      # Advanced data exploration UI
│   │   ├── enrichment/         # Company enrichment pipeline plugin
│   │   ├── industrial-matrix/  # Industrial readiness scoring
│   │   ├── intelligence-feed/  # Weekly briefing pipeline
│   │   ├── lp-portal/          # LP-facing fund reporting
│   │   ├── news-feed/          # Company news tracking
│   │   └── trend-reports/      # Market trend report generation
│   └── _staging/               # Plugin code being packaged (not yet installable)
│       ├── packages/           # Plugin packages under development
│       └── workers/            # Worker code staged for plugin packaging
│
├── integrations/               # External service integrations
│   ├── google-drive/           # Standalone Google Drive OAuth service
│   │   ├── app.py              # Flask app for OAuth callback handling
│   │   ├── drive_client.py     # Drive API wrapper
│   │   ├── config.py           # Drive integration config
│   │   ├── run.sh              # Start the integration service
│   │   └── requirements.txt    # Python deps for this service
│   └── mcp/                    # Model Context Protocol server
│       └── cvc_api_server.py   # MCP server exposing platform API to AI tools
│
├── config/                     # Team configuration — customized per deployment
│   ├── team.json               # Active team config (name, sectors, roles, etc.)
│   ├── team.example.json       # Template to copy when setting up a new deployment
│   └── manifests/              # Worker/pipeline config manifests
│       └── Q2-2026.json        # Q2 2026 worker targets (RSS feeds, tickers, IPC codes)
│
├── data/                       # Data files and database utilities
│   ├── demo_data.sql           # SQL seed for demo/test environments
│   ├── cvc_test_data.zip       # Archived snapshot of test data
│   ├── test_data/              # JSON fixtures used by import scripts and tests
│   │   ├── companies.json
│   │   ├── funding_rounds.json
│   │   ├── partners.json
│   │   ├── portfolio.json
│   │   └── meta.json
│   └── sql/                    # Utility SQL queries (not migrations)
│       └── verify_portfolio_status.sql
│
├── scripts/                    # Dev, ops, and setup scripts
│   ├── run_local.sh            # Start local dev (PostgreSQL + API)
│   ├── migrate.sh              # Apply all DB migrations
│   ├── install.sh              # New deployment install script
│   ├── install_plugin.sh       # Install a plugin into plugins/installed/
│   ├── docker_entrypoint.sh    # Container startup script
│   ├── smoke_test.sh           # Quick API health check
│   ├── run_django.sh           # Start deprecated Django backend (legacy)
│   ├── gdrive_auth.py          # CLI tool to authorize Google Drive OAuth
│   ├── import_test_data.py     # Load test_data/ fixtures into DB
│   ├── seed_demo.py            # Seed the DB with demo data
│   ├── warmup_embeddings.py    # Pre-compute embeddings for existing companies
│   ├── diff_portfolio.py       # Compare portfolio snapshots
│   ├── enrich_company_data.py  # Run enrichment on a single company (sync)
│   ├── enrich_company_data_async.py  # Run enrichment on a single company (async)
│   └── ops/                    # Operational runbooks as scripts
│       └── enrich_run.sh       # Trigger a batch enrichment run
│
├── tests/                      # Test suite
│   ├── test_core_features.py   # Unit/integration tests for core modules
│   ├── smoke_test.py           # Python smoke test (mirrors smoke_test.sh)
│   ├── db_integrity.py         # DB constraint + data integrity checks
│   └── e2e/                    # End-to-end browser tests (Playwright)
│       ├── auth.setup.ts       # Auth state setup for E2E tests
│       ├── homepage.spec.ts
│       ├── ventures.spec.ts
│       ├── admin.spec.ts
│       ├── brambles.spec.ts
│       ├── enrichment.spec.ts
│       ├── requests.spec.ts
│       └── sales.spec.ts
│
├── docs/                       # Architecture and reference documentation
│   ├── PHASE1_BUILD_PLAN.md    # Auth + roles build plan (Phase 1 complete)
│   ├── DECISIONS.md            # Key architecture decisions (do not re-litigate)
│   ├── DATABASE_SCHEMA.md      # Full DB table reference
│   ├── PLUGIN_INTERFACE.md     # Plugin contract / API spec
│   ├── PRODUCT_VISION.md       # CVC-specific product vision (original deployment)
│   ├── VISION.md               # Platform-level long-term vision
│   ├── ISO27001_SOC2_GAPS.md   # Security compliance gap analysis
│   ├── KEYCLOAK_DUPLO.md       # Keycloak + DuploCloud integration notes
│   └── compliance/             # Compliance monitoring artifacts
│       └── monitoring/
│
├── onboarding/                 # New deployment setup guides
│   ├── SETUP_GUIDE.md          # Step-by-step install for a new team
│   ├── GOLIVE_CHECKLIST.md     # Pre-launch checklist
│   ├── DATA_MIGRATION.md       # How to migrate data from another system
│   ├── TEAM_INVITE.md          # How to add team members
│   ├── USER_GUIDE.md           # End-user guide for the platform
│   ├── sample_companies.csv    # Example CSV for initial company import
│   └── sample_partners.csv     # Example CSV for initial partner import
│
├── infra/                      # Infrastructure configuration
│   ├── tls/                    # TLS/reverse-proxy config examples
│   │   ├── Caddyfile.example   # Caddy reverse proxy config
│   │   └── nginx.conf.example  # Nginx reverse proxy config
│   └── scripts/                # Server-side ops scripts
│       └── backup_db.sh        # PostgreSQL backup script
│
├── chrome-extension/           # Browser extension for source verification
│   ├── manifest.json           # Extension manifest (MV3)
│   ├── background.js           # Service worker
│   ├── content.js              # Content script injected into pages
│   ├── content.css             # Styles injected by content script
│   ├── popup.html              # Extension popup UI
│   ├── popup.js                # Popup logic
│   └── icons/                  # Extension icons (16, 48, 128px)
│
├── logs/                       # Runtime log output (not committed)
│   ├── api.log                 # API server logs
│   └── vite.log                # Frontend dev server logs
│
└── backend/                    # DEPRECATED — legacy Django backend
    └── DEPRECATED.md           # Explains why this exists and is not used
```

---

## Key Relationships

- **`api/`** imports from **`core/`** for all DB access, LLM calls, and Drive logic
- **`workers/`** imports from **`core/`** independently — no dependency on `api/`
- **`plugins/installed/`** are loaded at startup by `api/plugin_loader.py`
- **`designs/figma-dashboard/`** builds into **`api/static/app/`** for production
- **`config/team.json`** is read by `core/config.py` and shapes the entire platform behaviour
- **`core/db/migrations/`** are applied by `scripts/migrate.sh` in filename order
