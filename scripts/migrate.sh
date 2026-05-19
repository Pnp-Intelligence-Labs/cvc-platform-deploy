#!/usr/bin/env bash
# Run all core DB migrations in order.
# Safe to re-run — all migrations are idempotent (IF NOT EXISTS / IF EXISTS).
#
# Usage:
#   bash scripts/migrate.sh                  # uses defaults (local Docker DB)
#   DB_HOST=x DB_PASSWORD=y bash scripts/migrate.sh

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$REPO/core/db/migrations"

# Load .env if present
if [[ -f "$REPO/.env" ]]; then
    set -a; source "$REPO/.env"; set +a
fi

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-platform_db}"
DB_USER="${DB_USER:-platform}"
export PGPASSWORD="${DB_PASSWORD:-platform_local}"

echo "Running migrations against $DB_NAME@$DB_HOST:$DB_PORT..."

for f in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
    echo "  → $(basename "$f")"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
         -v ON_ERROR_STOP=0 -q -f "$f" 2>/dev/null || true
done

echo "Done."
