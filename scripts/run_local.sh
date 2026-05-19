#!/usr/bin/env bash
# Run the platform locally on Linux/WSL.
# PostgreSQL runs in Docker, API runs natively with hot reload on port 8002.
#
# Usage:
#   bash scripts/run_local.sh          # start everything
#   bash scripts/run_local.sh --stop   # stop the DB container

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${1:-}" == "--stop" ]]; then
    echo "Stopping platform-db..."
    docker compose -f "$REPO/docker-compose.dev.yml" down
    exit 0
fi

# ── Load .env ─────────────────────────────────────────────────────────────────
if [[ ! -f "$REPO/.env" ]]; then
    echo "ERROR: .env not found. Copy .env.example to .env and fill in values."
    exit 1
fi
set -a; source "$REPO/.env"; set +a

# ── Start PostgreSQL ──────────────────────────────────────────────────────────
if ! docker ps --filter "name=platform-db" --filter "status=running" -q | grep -q .; then
    echo "Starting PostgreSQL in Docker..."
    docker compose -f "$REPO/docker-compose.dev.yml" up -d
    echo -n "Waiting for DB to be ready"
    until docker exec platform-db pg_isready -U platform -d platform_db >/dev/null 2>&1; do
        echo -n "."; sleep 1
    done
    echo " ready."
    bash "$REPO/scripts/migrate.sh"
else
    echo "PostgreSQL already running."
fi

# ── Python venv ───────────────────────────────────────────────────────────────
if [[ ! -d "$REPO/.venv" ]]; then
    echo "Creating Python venv..."
    python3 -m venv "$REPO/.venv"
    "$REPO/.venv/bin/pip" install --quiet --upgrade pip
    "$REPO/.venv/bin/pip" install --quiet -r "$REPO/requirements.txt"
fi

# ── Start API ─────────────────────────────────────────────────────────────────
if pgrep -f "uvicorn api.main:app" >/dev/null 2>&1; then
    echo "API already running. Stop it first: pkill -f 'uvicorn api.main'"
    exit 0
fi

echo ""
echo "Platform running at http://127.0.0.1:8002/app"
echo ""

source "$REPO/.venv/bin/activate"
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=platform_db
export DB_USER=platform
export DB_PASSWORD=platform_local

PYTHONPATH="$REPO:$REPO/core" exec python -m uvicorn api.main:app \
    --host 127.0.0.1 --port 8002 --reload
