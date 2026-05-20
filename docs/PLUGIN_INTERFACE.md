# Plugin Interface Specification
**Created: 2026-05-19**

Defines the contract between the core platform and optional plugin packages.
All plugins follow this spec exactly — no exceptions.

---

## Principles

- **Zero bleed.** Plugin code never appears in the core repo.
  Core ships clean. Plugins install on top.
- **Graceful core.** Core endpoints never call plugin tables or routes.
  If a plugin table is absent, core falls back silently.
- **Discovery over configuration.** The platform scans `plugins/installed/`
  at startup — no manual registration in main.py.
- **Additive migrations only.** Plugins add their own tables.
  They never modify core tables (ALTER TABLE on a core table is rejected).

---

## Plugin Package Layout

Each plugin is a directory installed into `plugins/installed/<plugin-slug>/`:

```
plugins/installed/
└── dd-pipeline/              ← plugin slug (kebab-case)
    ├── manifest.json         ← required: identity + routing declaration
    ├── routes.py             ← required: FastAPI router, imported by plugin_loader
    ├── migrations/           ← required: numbered SQL files
    │   ├── 001_dd_tables.sql
    │   └── 002_dd_indexes.sql
    └── workers/              ← optional: background worker scripts
        └── forge.py
```

`plugins/installed/` is in `.gitignore`. It is never committed to the core repo.
The private plugin registry manages packaging and versioning.

---

## manifest.json

```json
{
  "slug":        "dd-pipeline",
  "name":        "DD Pipeline",
  "version":     "1.0.0",
  "description": "Due diligence workflow, dataroom processing, IC memo generation",
  "routes": {
    "prefix":    "/admin/dd",
    "tag":       "dd"
  },
  "nav": {
    "label":     "DD Pipeline",
    "path":      "/dd",
    "icon":      "FileText",
    "roles":     ["GP", "Principal", "Director", "Ventures"]
  },
  "requires_tables": ["dd_runs", "dd_agents", "dd_overview"],
  "config_schema": {}
}
```

**Fields:**

| Field | Required | Description |
|---|---|---|
| `slug` | yes | Unique identifier. Must match directory name. |
| `name` | yes | Human-readable display name |
| `version` | yes | Semver string |
| `routes.prefix` | yes | URL prefix where this plugin's router mounts |
| `routes.tag` | yes | OpenAPI tag for this router |
| `nav` | no | If present and non-null, platform nav injects this entry. Set to `null` to install the plugin without surfacing it in the UI. |
| `nav.roles` | no | Which roles see this nav item. Omit = all roles. |
| `nav.path` | yes (if nav present) | React Router path — no `/app` prefix (e.g. `/explore` not `/app/explore`) |
| `requires_tables` | no | List of table names (under `cvc.` schema) this plugin creates. Used by health check. |
| `config_schema` | no | JSON Schema fragment for plugin-specific config keys in team.json |

**`nav: null` is the correct default for most plugins.** A plugin installed with `nav: null` is fully functional — its API routes are mounted and its migrations run — but it does not inject a nav item. Teams enable the nav entry only for plugins they have licensed and want to surface to users. This prevents a new deployment from accidentally exposing the full feature set before a team has been onboarded to it.

**API restart required after manifest changes.** The platform reads all plugin manifests once at startup and caches them in memory. If you change a manifest (including toggling `nav`), you must restart the API for the change to take effect. A hard browser refresh alone is not enough — the frontend reads plugin config from the API, not from disk.

---

## routes.py

Must export exactly one object named `router`:

```python
from fastapi import APIRouter, Depends
from api.auth import require_auth

router = APIRouter()

@router.get("/status/{company_id}")
def dd_status(company_id: int, user=Depends(require_auth)):
    ...
```

**Rules:**
- All routes requiring auth use `Depends(require_auth)`.
- Routes are mounted at the `prefix` declared in manifest.json.
- No side effects at import time (no DB calls, no file I/O at module level).
- Must not import from or call any other plugin's routes.

---

## Migrations

Plugin migrations run **after** all core migrations during install.
They are numbered independently of core migrations.

**Conventions:**
- Files named `NNN_description.sql` (zero-padded three digits)
- All tables created under `cvc.` schema — no other schemas
- All statements use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`
- Never `ALTER TABLE` a core table — add your own join table instead
- Never `DROP` anything — migrations are one-way additive only

Plugin migrations run via `scripts/install.sh` at install time and
via `scripts/install_plugin.sh <slug>` when adding a plugin post-deploy.

---

## Frontend Injection

The platform frontend is a compiled React SPA. Plugins inject frontend pages at
**build time**, not runtime.

**How it works:**

1. Plugin package ships a `frontend/` directory alongside `routes.py`:
   ```
   plugins/installed/dd-pipeline/
   ├── frontend/
   │   ├── pages/DDPipelinePage.tsx
   │   └── components/DDStatusCard.tsx
   ```

2. `scripts/install_plugin.sh` copies these into
   `designs/figma-dashboard/src/plugins/<slug>/` and runs `npm run build`.

3. The build process includes them in the final bundle.

4. At runtime, the frontend calls `GET /config/plugins` (see below) to get
   the list of installed plugins and their nav declarations. It renders
   nav items and routes only for installed plugins.

**Core frontend contract:**

- `GET /config/plugins` returns the active plugin list from `plugins/installed/`
- The `<PluginNav>` component in `CVCNavbar.tsx` reads this and renders injected nav entries
- Dynamic routes for plugins are registered in `src/app/Router.tsx` using a
  lazy-import pattern keyed on the plugin slug

Plugins must NOT modify `CVCNavbar.tsx`, `Router.tsx`, or any other core file.
The install script handles route registration by appending to a
`src/plugins/registry.ts` file that the core router imports.

---

## Config Schema Extension

Plugins can add keys to `config/team.json` by declaring a `config_schema`
in their manifest. The installer merges plugin config keys into team.json.

Example — a plugin adding its own config block:

**manifest.json:**
```json
{
  "config_schema": {
    "dd_pipeline": {
      "workdir": "/mnt/storage/dd",
      "output_bucket": "dd-outputs",
      "ic_memo_template": "default"
    }
  }
}
```

After install, `config/team.json` gains a `"dd_pipeline": {...}` block.
The plugin reads this via `GET /config` (the core config endpoint already
returns the full team.json — no changes to core needed).

---

## Plugin Health Check

`GET /admin/plugins/health` (core endpoint, ships with platform) returns:

```json
{
  "installed": [
    {
      "slug":    "dd-pipeline",
      "name":    "DD Pipeline",
      "version": "1.0.0",
      "status":  "healthy",
      "tables_present": true
    }
  ]
}
```

A plugin is `"healthy"` if:
- `routes.py` imports without error
- All tables in `requires_tables` exist in the DB

---

## Install & Uninstall

### Installing a plugin

```bash
bash scripts/install_plugin.sh dd-pipeline /path/to/dd-pipeline-1.0.0.tar.gz
```

This script:
1. Extracts the package into `plugins/installed/<slug>/`
2. Runs plugin migrations against the DB
3. Merges plugin config schema into `config/team.json`
4. Copies frontend files and rebuilds the React app
5. Restarts the API server (or prompts the operator to do so)

### Uninstalling a plugin

Uninstall is manual — the team drops plugin tables if desired and removes the
`plugins/installed/<slug>/` directory. There is no automated uninstall script.
This is intentional: data in plugin tables may be valuable and should not be
dropped automatically.

---

## Plugin Staging Area

`plugins/_staging/` in this repo is a holding area for plugin code before it
is packaged into a private registry distribution.

- `plugins/_staging/routes/` → becomes `routes.py` in the plugin package
- `plugins/_staging/pages/` → becomes `frontend/pages/` in the plugin package
- `plugins/_staging/workers/` → becomes `workers/` in the plugin package

When a plugin is ready for distribution:
1. Copy staged files to a new private repo (e.g., `natelouie11-tech/plugin-dd-pipeline`)
2. Add `manifest.json` and `migrations/`
3. Tag a release and publish to the private plugin registry
4. Remove the code from `plugins/_staging/` in this repo

---

## Reference: Installed Plugin List (Current Staging)

These plugins exist in `plugins/_staging/` and are candidates for packaging:

| Slug | Staged Routes | Staged Workers | Status |
|---|---|---|---|
| `dd-pipeline` | `enrichment.py` | `workers/dd/` | Staged |
| `intelligence-feed` | `intelligence.py`, `news.py` | `workers/briefing/` | Staged |
| `industrial-matrix` | `industrial.py` | `workers/enrichment/enrich_industrial.py` | Staged |
| `lp-portal` | `lp.py` | — | Staged |
| `data-explorer` | `explorer.py` | — | Staged |
| `trend-reports` | `trend_reports.py`, `trends.py` | `workers/trends/` | Staged |
| `portfolio-news` | `news.py` (partial) | `workers/enrichment/portco_news_worker.py` | Staged |
