#!/usr/bin/env bash
# Run all DB migrations — core first, then any installed plugins.
# Safe to re-run — all migrations are idempotent (IF NOT EXISTS / IF EXISTS).
#
# Usage:
#   bash scripts/migrate.sh                  # uses defaults (local Docker DB)
#   DB_HOST=x DB_PASSWORD=y bash scripts/migrate.sh

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE_MIGRATIONS="$REPO/core/db/migrations"
PLUGINS_DIR="$REPO/plugins/installed"

# Load .env if present
if [[ -f "$REPO/.env" ]]; then
    set -a; source "$REPO/.env"; set +a
fi

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-platform_db}"
DB_USER="${DB_USER:-platform}"
export PGPASSWORD="${DB_PASSWORD:-platform_local}"

run_sql() {
    local file="$1"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
         -v ON_ERROR_STOP=0 -q -f "$file" 2>/dev/null || true
}

echo "Running migrations against $DB_NAME@$DB_HOST:$DB_PORT..."

# ── 1. Core migrations ────────────────────────────────────────────────────────
echo ""
echo "Core migrations:"
shopt -s nullglob
core_files=("$CORE_MIGRATIONS"/*.sql)
shopt -u nullglob
IFS=$'\n' sorted=($(printf '%s\n' "${core_files[@]}" | sort))
unset IFS
for f in "${sorted[@]}"; do
    echo "  → $(basename "$f")"
    run_sql "$f"
done

# ── 2. Plugin migrations (plugins/installed/<slug>/migrations/*.sql) ──────────
if [[ -d "$PLUGINS_DIR" ]]; then
    for plugin_dir in "$PLUGINS_DIR"/*/; do
        mig_dir="${plugin_dir}migrations"
        if [[ -d "$mig_dir" ]]; then
            slug="$(basename "$plugin_dir")"
            shopt -s nullglob
            files=("$mig_dir"/*.sql)
            shopt -u nullglob
            if [[ ${#files[@]} -gt 0 ]]; then
                echo ""
                echo "Plugin migrations: $slug"
                shopt -s nullglob
                plugin_files=("$mig_dir"/*.sql)
                shopt -u nullglob
                IFS=$'\n' sorted=($(printf '%s\n' "${plugin_files[@]}" | sort))
                unset IFS
                for f in "${sorted[@]}"; do
                    echo "  → $(basename "$f")"
                    run_sql "$f"
                done
            fi
        fi
    done
fi

echo ""
echo "Done."
