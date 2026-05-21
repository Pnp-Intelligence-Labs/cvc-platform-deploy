# Activity Log

Running log of work done in this repo. Newest entries at the top. Per project rule: every change the user makes (or directs) gets recorded here.

Format: `YYYY-MM-DD — short title` followed by what changed and why.

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
