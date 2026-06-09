#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="$ROOT/integrations/google-drive"
VENV="$APP_DIR/.venv"

cd "$APP_DIR"

if [[ ! -d "$VENV" ]]; then
  python3 -m venv "$VENV"
fi

source "$VENV/bin/activate"
pip install -q -r requirements.txt

if [[ -f "$ROOT/.env" ]]; then
  set -a
  source "$ROOT/.env"
  set +a
fi

if [[ -f "$APP_DIR/.env" ]]; then
  set -a
  source "$APP_DIR/.env"
  set +a
fi

HOST="${GDRIVE_INGEST_HOST:-127.0.0.1}"
PORT="${GDRIVE_INGEST_PORT:-8085}"

echo "Google Drive ingestion engine: http://${HOST}:${PORT}"
exec python -m uvicorn app:app --host "$HOST" --port "$PORT" --reload
