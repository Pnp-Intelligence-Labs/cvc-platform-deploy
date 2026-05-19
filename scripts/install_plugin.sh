#!/bin/bash
# install_plugin.sh — install a platform plugin from a tarball
#
# Usage:
#   bash scripts/install_plugin.sh <slug> <path-to-plugin.tar.gz>
#
# Example:
#   bash scripts/install_plugin.sh dd-pipeline ~/downloads/dd-pipeline-1.0.0.tar.gz
#
# What this does:
#   1. Extracts the plugin package into plugins/installed/<slug>/
#   2. Runs plugin migrations against the database
#   3. Merges plugin config keys into config/team.json (if config_schema present)
#   4. Copies frontend files into designs/figma-dashboard/src/plugins/<slug>/
#   5. Rebuilds the React frontend
#   6. Prints instructions to restart the API

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ -z "$1" || -z "$2" ]]; then
    echo "Usage: bash scripts/install_plugin.sh <slug> <path-to-plugin.tar.gz>"
    exit 1
fi

SLUG="$1"
TARBALL="$2"

if [[ ! -f "$TARBALL" ]]; then
    echo "Error: file not found: $TARBALL"
    exit 1
fi

INSTALL_DIR="$REPO_ROOT/plugins/installed/$SLUG"

echo ""
echo "=== Installing plugin: $SLUG ==="
echo ""

# ── 1. Extract ────────────────────────────────────────────────────────────────
echo "[ 1/5 ] Extracting package..."
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
tar -xzf "$TARBALL" -C "$INSTALL_DIR" --strip-components=1
echo "       Installed to: $INSTALL_DIR"

# Validate manifest
if [[ ! -f "$INSTALL_DIR/manifest.json" ]]; then
    echo "Error: manifest.json not found in package. Invalid plugin."
    rm -rf "$INSTALL_DIR"
    exit 1
fi

PLUGIN_NAME=$(python3 -c "import json; m=json.load(open('$INSTALL_DIR/manifest.json')); print(m['name'])")
PLUGIN_VERSION=$(python3 -c "import json; m=json.load(open('$INSTALL_DIR/manifest.json')); print(m['version'])")
echo "       Plugin: $PLUGIN_NAME v$PLUGIN_VERSION"

# ── 2. Run migrations ─────────────────────────────────────────────────────────
MIGRATIONS_DIR="$INSTALL_DIR/migrations"
if [[ -d "$MIGRATIONS_DIR" && -n "$(ls -A "$MIGRATIONS_DIR"/*.sql 2>/dev/null)" ]]; then
    echo "[ 2/5 ] Running migrations..."
    # Load DB connection from .env
    if [[ -f "$REPO_ROOT/.env" ]]; then
        export $(grep -v '^#' "$REPO_ROOT/.env" | xargs)
    fi
    DB_HOST="${DB_HOST:-localhost}"
    DB_PORT="${DB_PORT:-5432}"
    DB_NAME="${DB_NAME:-cvc_db}"
    DB_USER="${DB_USER:-producer}"
    DB_PASSWORD="${DB_PASSWORD:-producer_2026}"

    for migration in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
        echo "       Applying: $(basename $migration)"
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$migration"
    done
    echo "       Migrations complete."
else
    echo "[ 2/5 ] No migrations found — skipping."
fi

# ── 3. Merge config schema ────────────────────────────────────────────────────
echo "[ 3/5 ] Merging config schema..."
CONFIG_FILE="$REPO_ROOT/config/team.json"
if [[ -f "$CONFIG_FILE" ]]; then
    python3 - <<PYEOF
import json

manifest = json.load(open("$INSTALL_DIR/manifest.json"))
config_schema = manifest.get("config_schema", {})

if config_schema:
    team_config = json.load(open("$CONFIG_FILE"))
    changed = False
    for key, defaults in config_schema.items():
        if key not in team_config:
            team_config[key] = defaults
            changed = True
            print(f"       Added config block: {key}")
    if changed:
        with open("$CONFIG_FILE", "w") as f:
            json.dump(team_config, f, indent=2)
        print("       config/team.json updated.")
    else:
        print("       Config keys already present — no changes.")
else:
    print("       No config schema declared — skipping.")
PYEOF
else
    echo "       config/team.json not found — skipping config merge."
fi

# ── 4. Copy frontend files ────────────────────────────────────────────────────
FRONTEND_SRC="$INSTALL_DIR/frontend"
FRONTEND_DEST="$REPO_ROOT/designs/figma-dashboard/src/plugins/$SLUG"

if [[ -d "$FRONTEND_SRC" ]]; then
    echo "[ 4/5 ] Installing frontend files..."
    rm -rf "$FRONTEND_DEST"
    mkdir -p "$FRONTEND_DEST"
    cp -r "$FRONTEND_SRC/." "$FRONTEND_DEST/"
    echo "       Frontend files installed to: src/plugins/$SLUG/"

    # Rebuild frontend
    FRONTEND_DIR="$REPO_ROOT/designs/figma-dashboard"
    if [[ -d "$FRONTEND_DIR/node_modules" ]]; then
        echo "       Rebuilding frontend..."
        cd "$FRONTEND_DIR"
        npm run build
        cd "$REPO_ROOT"
        echo "       Frontend rebuilt."
    else
        echo "       Warning: node_modules not found. Run 'npm install' in designs/figma-dashboard/ then rebuild."
    fi
else
    echo "[ 4/5 ] No frontend directory in package — skipping."
fi

# ── 5. Done ───────────────────────────────────────────────────────────────────
echo ""
echo "=== Plugin '$PLUGIN_NAME v$PLUGIN_VERSION' installed successfully ==="
echo ""
echo "Next step: restart the API server to load the plugin routes."
echo "  If using run_local.sh: stop it and run again."
echo "  If using systemd:      sudo systemctl restart platform-api"
echo ""
