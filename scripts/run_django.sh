#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

# Load .env if present
if [ -f "$ROOT/.env" ]; then
  set -o allexport
  source "$ROOT/.env"
  set +o allexport
fi

export DJANGO_SETTINGS_MODULE=config.settings
export DB_PASSWORD="${DB_PASSWORD:-platform_local}"
export DB_HOST="${DB_HOST:-localhost}"
export DB_PORT="${DB_PORT:-5432}"
export DB_NAME="${DB_NAME:-platform_db}"
export DB_USER="${DB_USER:-platform}"

echo "Starting Django service on port ${DJANGO_PORT:-8003}..."
uv run --directory "$ROOT" python backend/manage.py runserver "0.0.0.0:${DJANGO_PORT:-8003}"
