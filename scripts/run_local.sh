#!/usr/bin/env bash
# Boot CVC Intelligence Platform locally on macOS.
# Starts: portable PostgreSQL 16 (port 5433) + FastAPI (port 8001).
# Re-run anytime — Postgres restart is idempotent.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_HOME="$HOME/cvc-local"
export PGDATA="$PG_HOME/pgdata"
export PATH="$PG_HOME/pgsql/bin:$PATH"

if [[ ! -x "$PG_HOME/pgsql/bin/postgres" ]]; then
    echo "Postgres binary not found at $PG_HOME/pgsql — see ORIENTATION_LOCAL.md for setup."
    exit 1
fi

if ! pg_isready -h 127.0.0.1 -p 5433 -U producer >/dev/null 2>&1; then
    echo "Starting Postgres on port 5433..."
    pg_ctl -D "$PGDATA" -l "$PG_HOME/postgres.log" -o "-p 5433 -k $PG_HOME" -w start
else
    echo "Postgres already running on port 5433"
fi

cd "$REPO"

if [[ ! -d ".venv" ]]; then
    echo "Creating Python venv..."
    python3 -m venv .venv
    .venv/bin/pip install --upgrade pip >/dev/null
    .venv/bin/pip install fastapi uvicorn[standard] pydantic python-multipart \
        psycopg2-binary 'python-jose[cryptography]' bcrypt requests beautifulsoup4 \
        feedparser youtube-transcript-api python-dotenv openpyxl >/dev/null
fi

if pgrep -f "uvicorn api.main:app" >/dev/null 2>&1; then
    echo "API already running. Stop it first: pkill -f 'uvicorn api.main'"
    exit 0
fi

echo "Starting FastAPI on http://127.0.0.1:8001 ..."
source .venv/bin/activate
PYTHONPATH="$REPO:$REPO/core" exec python -m uvicorn api.main:app \
    --host 127.0.0.1 --port 8001 --reload
