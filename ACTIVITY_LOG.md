# Activity Log

Running log of work done in this repo. Newest entries at the top. Per project rule: every change the user makes (or directs) gets recorded here.

Format: `YYYY-MM-DD — short title` followed by what changed and why.

## 2026-05-29 — Remove unused imports (dead-code sweep)

**What changed:** Removed 4 verified-unused imports (zero call sites, confirmed by grep). No rebuild needed — backend only.
- `api/routes/admin.py`: dropped `List` from typing import and the `import asyncio` line.
- `api/routes/partners.py`: dropped `List` from typing import.
- `api/routes/portfolio.py`: dropped `json` from `import json, re, datetime as _dt`.
- `api/routes/sourcing.py`: dropped `HTTPException` from the fastapi import.

**Why:** Dead-code cleanup. No functional impact.

**Verified:** `python3 -m py_compile` passes for all four.

**Not done (needs frontend rebuild, left in place):** 3 dead React components — `QQQIntelPanel.tsx` (~348 LOC), `ScoreSuggestionCard.tsx` (~78 LOC), `figma/ImageWithFallback.tsx` (~27 LOC). Never imported; delete + rebuild `api/static/app/` when convenient.

## 2026-05-29 — Fix two error-path bugs in proxycurl.py

**What changed:**
- `core/web/proxycurl.py` `get_profile()`: `error_msg` was only assigned in the non-429 / exception branches. If every retry returned HTTP 429 (rate limited), the `continue` skipped assignment, so the post-loop `f"Failed after retries: {error_msg}"` raised `NameError: name 'error_msg' is not defined` — masking the real rate-limit failure with a crash. Initialized `error_msg` to a sensible 429 default before the retry loop.
- `core/web/proxycurl.py` `search_profile()`: `name.split()[0]` raised `IndexError` when `name` was empty or whitespace-only, and `name.split()` was called 3×. Split once into `name_parts`, guard the empty case with an early `found: False` return, reuse the list.

**Why:** Both are error-path only (rate-limit exhaustion / bad input) — no change to the success path or normal functionality. Found during a platform-wide bug sweep.

**Verified:** `python3 -m py_compile core/web/proxycurl.py` passes.

## 2026-05-26 — Fix ingest 500 on expired/invalid Drive token

**What changed:**
- `api/routes/drive.py`: `ingest_files` was missing try/except around `_service()`. If the Drive token expired and the refresh failed (e.g. revoked token or network error), the `google.auth.exceptions.RefreshError` propagated all the way to Starlette, returning an opaque plain-text 500. Added the same `try/except HTTPException: raise / except Exception as e: raise HTTPException(503, ...)` pattern already used in `browse_drive`.
- `requirements.txt`: Added `google-auth`, `google-auth-oauthlib`, `google-auth-httplib2`, `google-api-python-client` (Drive OAuth deps) and `markitdown`, `pandas`, `openpyxl` (DD plugin file conversion deps). These were installed in the venv but not tracked in requirements, so `run_local.sh` fresh-venv setups would fail to convert files.
- Installed `markitdown`, `pandas`, `openpyxl` into the existing venv.

## 2026-05-26 — Drive OAuth & ingestion hardening

**What changed:**
- `api/routes/drive.py`: Fixed critical token-refresh bug (refreshed token was never written back to disk, causing eventual 503s). Made credential paths env-configurable via `GDRIVE_CREDS_PATH` / `GDRIVE_TOKEN_PATH`. Added `PLATFORM_BASE_URL` env var for redirect URI. Added web-based OAuth flow (`GET /drive/auth` + `GET /drive/callback` on a public router) so auth can be initiated from the UI on any machine — replaces needing to run `scripts/gdrive_auth.py` locally. Added `GET /drive/auth-status` endpoint so the UI can check connection state before attempting to browse.
- `api/main.py`: Registered `drive_public_router` (auth + callback) without JWT requirement, since Google's OAuth redirect doesn't carry a JWT.
- `designs/figma-dashboard/src/app/pages/DriveIngestPage.tsx`: Added Drive auth-status check on mount; shows a "Connect Google Drive" gate if not authenticated; handles `?drive_connected=1` and `?drive_error=…` URL params from OAuth redirect.
- `.env`: Expanded `ALLOWED_ORIGINS` to include `127.0.0.1` variants; added `PLATFORM_BASE_URL`, `GDRIVE_CREDS_PATH`, `GDRIVE_TOKEN_PATH` docs.
- Frontend rebuilt to `api/static/app/`.

## 2026-05-26

### Drive Ingestion — OAuth auth + deingest feature
- `~/producer/gdrive_credentials.json` — saved web OAuth credentials for verricalos Google project
- `scripts/gdrive_auth.py` — one-time OAuth flow script; saves token to `~/producer/gdrive_token.json`
- `api/routes/drive.py` — added `GET /drive/ingested` (list ingested companies) and `DELETE /drive/ingested/{company}` (remove ingested data)
- `designs/figma-dashboard/src/app/pages/DriveIngestPage.tsx` — added "Ingested" panel in right column showing all ingested companies with "Remove" deingest button; list auto-refreshes after each ingest
- Frontend rebuilt to `api/static/app/`

### Drive Ingestion UI — full-drive browser + ingest pipeline
- `api/routes/drive.py` — new `GET /drive/browse` (returns full Drive tree up to 3 folders deep) and `POST /drive/ingest` (downloads selected files, runs convert + tag pipeline, returns manifest)
- `designs/figma-dashboard/src/app/pages/DriveIngestPage.tsx` — new page at `/ingest`: collapsible Drive tree with checkboxes, select-all/clear per folder, ingest controls with company name, results panel with doc-type badges (high/medium/low tier), per-doc conversion status
- Registered in `api/main.py` (`/drive` prefix, auth-gated), `routes.tsx`, and `CVCNavbar.tsx` ("Ingest" link next to Admin for admin users)

---

## 2026-05-21

### High-priority fixes from code-health audit (uncommitted)
- **Plugin layer de-CVC'd**: stripped `cvc.` schema prefix from all 7 plugin manifests, both plugin SQL migrations, and the 7 plugin route files (~250 SQL statements total). New teams can now install plugins without inheriting CVC's schema name.
- **Connection-level `search_path`**: added `APP_SCHEMA` env var (default `cvc`) to [core/db/connection.py](core/db/connection.py); every pooled connection now runs `SET search_path TO {APP_SCHEMA}, public` so unqualified table refs resolve to the right schema. Schema name validated against `[a-z_][a-z0-9_]*` to keep it injection-safe.
- **MCP server credentials moved to env**: [mcp/cvc_api_server.py](mcp/cvc_api_server.py) no longer hardcodes the Dell host, user, or `nate/cvc2026` API password. Now reads `DELL_HOST`, `DELL_USER`, `DELL_LOGS`, `DELL_API_BASE`, `DELL_API_USER`, `DELL_API_PASSWORD`. Note: credentials still exist in git history — rotate on the Dell server separately.
- **Docker entrypoint actually runs migrations**: [scripts/docker_entrypoint.sh](scripts/docker_entrypoint.sh) was calling `python -m core.db.migrate` (module doesn't exist). Switched to `bash /app/scripts/migrate.sh`. Also added `postgresql-client` to the [Dockerfile](Dockerfile) apt-install line so `psql` is available inside the container.
- **migrate.sh fails loudly**: removed the `-v ON_ERROR_STOP=0 ... 2>/dev/null || true` silent-swallow on [scripts/migrate.sh:29](scripts/migrate.sh#L29). Failed migrations now abort and surface the SQL error instead of looking successful.
- **Why:** This is half of a four-item "high priority" punch list from a full code-health audit. The schema fix is intentionally scoped to the *plugin* layer only — `api/routes/` and `core/db/migrations/` still have ~1,100 hardcoded `cvc.` references that need a separate, larger refactor before full white-label deployment is possible. The connection-level `search_path` makes that future refactor easier (it'll keep working with `cvc.` qualifiers too).

### PnPbert algorithm infusion — multi-vector late interaction recommendations (`f491c96`)
- New relevance engine at [core/pnpbert/engine.py](core/pnpbert/engine.py): MaxSim late-interaction scorer that compares a *set* of user-interest vectors against a *set* of per-entity facet vectors, instead of collapsing each side to one embedding. For each user token vector, it takes the max dot product across the entity's vectors, then sums — so a startup matches if *any* of its facets (sector, stage, geo, thesis blurb) aligns with *any* of the user's interests.
- Encoder strategy: primary path uses `sentence-transformers` (loaded lazily so the API still boots without it); fallback is a pure-numpy TF-IDF encoder so deployments without the ML stack still get ranked results instead of an error.
- New API surface at [api/routes/recommendations.py](api/routes/recommendations.py): `GET /recommendations/startups` and `GET /recommendations/feed`. Ranking inputs are the user's role, recently-viewed sectors, and the focus areas of partners they're assigned to — so the feed personalizes per analyst, not per team.
- Router registered in [api/main.py](api/main.py); install + migrate scripts touched to pull in the new module.
- **Why MaxSim over cosine on a mean-pooled vector:** a startup's "industrial automation" facet should be reachable by a user interested in "robotics" without needing the rest of the vectors to match — averaging would wash that signal out.

### Drag-and-drop stage moves on Sales kanban (`df695b7`)
- Sales kanban ([designs/figma-dashboard/src/app/pages/Sales.tsx](designs/figma-dashboard/src/app/pages/Sales.tsx)) now lets you grab any card and drop it into any other column — including the Won/Lost sub-sections inside the Closed column.
- **Optimistic UI**: the card jumps to the target column the instant you release; the `PATCH /sales/targets/{id}` request fires in the background and only rolls back if the server rejects it. No spinner, no full-list refetch.
- **Drag affordances**: source card fades and scales down during the gesture; target columns light up with a dashed drop-indicator border — blue for active pipeline columns, emerald for Won, red for Lost — so the drop zone is unambiguous even when columns are tightly packed.
- **Backend** ([api/routes/sales.py](api/routes/sales.py)): `TargetUpdate` schema gained a `stage` field, and the PATCH handler auto-sets `stage_changed_at` whenever the stage actually changes — so the kanban analytics (time-in-stage, velocity) stay correct without the frontend having to send a second field.
- **Why optimistic + auto-timestamp on the server:** dragging is a high-frequency interaction; making the user wait for a round-trip on every move would feel broken. Putting the timestamp on the server side means any future client (mobile, API consumer) gets consistent stage-history data without re-implementing the rule.

### Full database optimization — pooling, N+1 fixes, indexes, PG tuning (`064b173`)
- Connection pooling tuned.
- N+1 query patterns rewritten with eager loads/joins.
- Added indexes on hot query paths.
- Postgres server-side tuning applied.

---

## 2026-05-20

### Strip CVC/SLAM/industrials hardcoding from all plugins (`0280ad2`)
- Removed CVC team / SLAM / industrials sector references from plugin code.
- Plugins now generic so the platform is deployable to any VC team.

### Plugin nav toggle in Admin UI + install.sh hardening (`29e4f38`)
- Admins can toggle plugin navigation entries from the UI.
- `install.sh` made safer/more idempotent.

### Data Explorer 500 fix — stage/score distribution (`9209bbe`)
- Fixed `fetchone()[0]` → `fetchone()["count"]` after DB row-factory change.

### Manifest caching + nav:null default — docs (`7f19c93`)
- Documented manifest cache behavior and why `nav: null` is the default.

### Strip plugin nav bleed + remove QQQ from Partner page (`fad567f`)
- Plugin nav entries no longer leak into core nav.
- QQQ widget removed from Partner page.

### Remove explorer.py from staging (`a16573a`)
- `explorer.py` removed from `plugins/_staging/`; now shipped as `plugin-data-explorer v1.0.0`.

---

## 2026-05-19

### In-app onboarding wizard + help panel (`4b0373a`)
- First-run wizard for new deployments.
- Contextual help panel added.

### Sales `linked_target_id` migration + smoke test route fixes (`2b2d576`)
- Schema migration for `linked_target_id` on sales records.
- Smoke test hitting wrong routes — corrected.

### Onboarding suite — checklist, data migration, team invite (`afb0317`)
- Docs covering the full onboarding flow for a new VC team.

### API keys in plain English (`8f92c4d`)
- Docs explaining what each external API key unlocks, what it costs, and where to get it.

### README rewrite + data-explorer in install + sample CSVs (`b0a95a2`)
- README overhauled to match Plug-and-Play Vertical OS framing.
- `data-explorer` plugin included in install flow.
- Sample CSVs added for quick demo.

### Partner CSV import + user onboarding guide (`a697e30`)
- CSV import for partners.
- User-facing onboarding guide.

### Smoke test plugin routes + install.sh quote safety (`f1861e4`)
- Smoke tests now correctly hit plugin routes.
- `install.sh` team config writes are quote-safe.

### Smoke test script + setup guide verification section (`8a0d855`)
- New smoke test runner.
- Setup guide includes a verification checklist.

### Admin reset-password + Data Explorer polish (`c74850d`)
- Admin-initiated password reset endpoint.
- UI polish on Data Explorer.

### Plugin health dashboard + password reset UI (`631c471`)
- Admin can see which plugins are healthy.
- Password reset has a UI form.

### Demo seed script (`d707daf`)
- 30 companies, 4 partners, full pipeline — seeded for demo.

### User management UI on Admin Team tab (`ccba653`)
- Admins can manage users from the Team tab.

### CSV import UI on Companies tab (`4bdf4d2`)
- Companies tab gained CSV import UI.

### Plugin migrations — each plugin owns its DB schema (`21c0c51`)
- Migration runner per-plugin so plugins are fully self-contained.

### CSV company import, user management endpoints, setup guide updates (`81686f2`)
- Backend endpoints to support the above UI changes.

### Frontend rebuild with new plugin pages (`0e4c1c8`)
- Built bundle refreshed to include packaged plugin pages.

### Plugin install step in install.sh + AdminBatchJobs to core (`34aadc9`)
- `install.sh` now installs plugins.
- `AdminBatchJobs` promoted from plugin to core.

### Package trend-reports plugin + /reports route (`d87098d`)
- `trend-reports` now an installable plugin; mounted at `/reports`.

### Package enrichment plugin + wire EnrichmentQueue to frontend (`9234feb`)
- `enrichment` packaged as plugin.
- `EnrichmentQueue` UI wired to backend.

### Package industrial-matrix plugin (`c796ae6`)
- `industrial-matrix` packaged as plugin (generic — sector-agnostic naming).

### MinIO object storage — Phase 3.4 (`3aa055e`)
- MinIO added for object storage (uploads, exports, reports).

---

## Logging convention going forward

Each new change appends an entry under today's date with:
- Short title + commit SHA if applicable
- 1–3 bullets on what changed and why (why > what)
- Group entries under a `## YYYY-MM-DD` header (newest dates on top)

## 2026-05-27 — Ingestion pipeline bug fixes

**Files changed:** `plugins/_staging/workers/dd/ingestion/tagger.py`

**Bugs found and fixed:**

1. **Runtime error (system python):** `ingest.py` ran `ModuleNotFoundError: No module named 'google_auth_oauthlib'` when invoked with system `python3`. The packages are installed in `.venv`. Correct invocation is `.venv/bin/python -m ingestion.ingest` from the `plugins/_staging/workers/dd/` directory.

2. **Tagger underscore normalization:** Filenames like `financial_model_v2.xlsx`, `cap_table_2025.xlsx`, `balance_sheet.txt`, `customer_contract_acme.pdf` all use underscores/hyphens as word separators. Signals use spaces (`"financial model"`, `"cap table"`, etc.). Fixed by normalizing `_` and `-` → space before matching in `tag_document()`.

3. **Missing tagger signals:** `Financial Statements Q3.xlsx` (spaces, no underscores) still returned `unknown` because `"financial statement"` was not in the signal list — only sub-phrases like `"balance sheet"` were. Added `"financial statement"`, `"financial statements"` to `financial_statement` signals. Added `"customer contract"` to `customer_contract` signals.

**Verified:** All 12 real-world filename test cases now classify correctly. `ingest_local` end-to-end run passes. `ingest.py --dry-run` passes.

## 2026-05-29 — Fix PnPbert degraded mode
- Verified PnPbert ranking engine (core/pnpbert/engine.py) before data load: logic/ordering/edge-cases/determinism all correct, BUT running TF-IDF fallback — semantic encoder missing.
- Root cause: sentence-transformers not installed, absent from requirements.txt → silent fallback to exact-token matching. Relevant docs scored 0.0 (e.g. "payment rails" vs query "fintech payments").
- Fix: added `sentence-transformers>=3.0.0` to requirements.txt; installed in .venv (pulls torch).
- Re-verified: encoder now all-MiniLM-L6-v2. Semantically-relevant doc 0.0000 → 0.6918; fintech docs rank above agtech. Edge cases still safe.

## 2026-05-29 — Per-user Drive-powered "My Terminal"
- Goal: each individual authorizes their OWN Google Drive, ingests their own files into an isolated personal workspace, platform makes sense of them (doc type + summary + key points) + Q&A — separate from preexisting platform data.
- Drive auth was single global token (~/producer/gdrive_token.json). Made it per-user.
- Migration 135: cvc.user_drive_tokens (1 token/user) + cvc.drive_documents (per-user ingested docs, summary + key_points jsonb).
- core/drive/userauth.py: per-user token store (DB), OAuth via server-side state nonce → user_id (reuses already-registered /drive/callback redirect), refresh+persist, build_service(user_id).
- core/drive/browse.py + pipeline.py: shared Drive tree + download→convert→tag (wraps existing dd ingestion).
- core/drive/sense.py: "make sense" = summary + key_points per doc, and corpus Q&A. Uses OpenRouter if OPENROUTER_API_KEY set, else offline extractive fallback (works out of the box).
- api/routes/terminal.py: /terminal status, auth-url, browse, ingest, documents (list/get/delete), ask — all JWT-scoped to caller.
- Refactored api/routes/drive.py to per-user: auth-url (replaces public /auth), callback-by-state, per-user workdir (workdir/user_<id>/<company>).
- Frontend: TerminalPage.tsx (connect Drive, browse/select/ingest, My Documents w/ summaries, Ask box), route /terminal, "My Terminal" nav link (all roles); fixed DriveIngestPage connect to use /drive/auth-url.
- Verified: imports clean, migration applied, frontend builds, TestClient smoke (status from DB, real Google consent URL, 401 guard, empty-corpus ask). Live OAuth consent + real ingest require a browser session (not run here).

## 2026-05-29 — Fix Data Explorer broken in local dev (vite proxy)
- Root cause: designs/figma-dashboard/vite.config.ts proxy whitelist missing `/config` and `/explore`. In `npm run dev` (port 5173) those fetches fell through to vite → returned SPA index.html instead of API JSON. Effect: `/config/plugins` failed so the "Data Explorer" nav link never rendered, and all 8 `/explore/*` report fetches JSON-parse-failed. = "did not run locally".
- Backend was always fine: data-explorer plugin installed, mounts /explore, all 8 endpoints return 200, schema columns present (match_reviewed mig 090, outcome mig 098). Served via /app (built, same-origin) it worked; only the dev server broke.
- Fix: added `/config` and `/explore` to vite proxy. Verified through 5173 proxy: /config/plugins returns data-explorer JSON, /explore/sector-overview HTTP 200 application/json with real rows.
