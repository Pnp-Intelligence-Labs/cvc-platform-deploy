#!/usr/bin/env bash
# docker_entrypoint.sh — runs inside the container as CMD
# 1. Waits for the database to accept connections (up to 30 s)
# 2. Runs Python-based migrations
# 3. Starts uvicorn

set -e

# ── Production safety checks (NIST 3.13 / ISO 27001 A.8.24) ─────────────────
ENVIRONMENT="${ENVIRONMENT:-}"
if [ "${ENVIRONMENT}" = "production" ]; then
    if [ "${MINIO_SECURE:-false}" != "true" ]; then
        echo "[entrypoint] FATAL: MINIO_SECURE must be 'true' in production. Set MINIO_SECURE=true."
        exit 1
    fi
    if [ -z "${JWT_SECRET:-}" ]; then
        echo "[entrypoint] FATAL: JWT_SECRET must be set in production."
        exit 1
    fi
    if [ -z "${DATABASE_URL:-}" ] && [ -z "${DB_PASSWORD:-}" ]; then
        echo "[entrypoint] FATAL: Either DATABASE_URL or DB_PASSWORD must be set in production."
        exit 1
    fi
    if [ -z "${MINIO_SECRET_KEY:-}" ] || [ "${MINIO_SECRET_KEY}" = "CHANGE_ME" ] || [ "${MINIO_SECRET_KEY}" = "platform_local" ]; then
        echo "[entrypoint] FATAL: MINIO_SECRET_KEY must be set to a unique secret in production (not default)."
        exit 1
    fi
fi

# Warn if MFA is not enforced for any role
if [ -z "${MFA_REQUIRED_ROLES:-}" ]; then
    echo "[entrypoint] WARN: MFA_REQUIRED_ROLES is not set — MFA will not be required for any role. Recommended: set MFA_REQUIRED_ROLES=GP,PSM,Ventures in .env."
fi
# ─────────────────────────────────────────────────────────────────────────────

DB_HOST="${DB_HOST:-db}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-platform_db}"
DB_USER="${DB_USER:-platform}"
DB_PASSWORD="${DB_PASSWORD:-}"

if [ -n "${DATABASE_URL:-}" ]; then
    echo "[entrypoint] Waiting for database (DATABASE_URL) ..."
else
    echo "[entrypoint] Waiting for database at ${DB_HOST}:${DB_PORT} ..."
fi

MAX_WAIT=30
ELAPSED=0

until python -c "
import os, psycopg2, psycopg2.extensions, sys
url = os.environ.get('DATABASE_URL')
try:
    if url:
        psycopg2.connect(**psycopg2.extensions.parse_dsn(url)).close()
    else:
        psycopg2.connect(
            host='${DB_HOST}',
            port=${DB_PORT},
            dbname='${DB_NAME}',
            user='${DB_USER}',
            password='${DB_PASSWORD}'
        ).close()
except Exception:
    sys.exit(1)
" 2>/dev/null; do
    if [ "$ELAPSED" -ge "$MAX_WAIT" ]; then
        echo "[entrypoint] Database not reachable after ${MAX_WAIT}s — aborting."
        exit 1
    fi
    echo "[entrypoint] Database not ready yet — retrying in 2s (${ELAPSED}s elapsed)"
    sleep 2
    ELAPSED=$((ELAPSED + 2))
done

echo "[entrypoint] Database is ready."

# Skip migrations when the DB is managed externally (e.g. already migrated on a
# managed Postgres like Supabase/Neon). migrate.sh uses ON_ERROR_STOP=1, which
# aborts on the "already exists" errors a fully-migrated DB raises on re-run.
if [ "${RUN_MIGRATIONS:-true}" = "false" ]; then
    echo "[entrypoint] RUN_MIGRATIONS=false — skipping migrations (DB managed externally)."
else
    echo "[entrypoint] Running migrations ..."
    bash /app/scripts/migrate.sh
fi

echo "[entrypoint] Starting API server ..."
# Single worker: ingest job state (api/routes/terminal.py + drive.py _jobs) is
# in-process memory — with >1 worker, status polls land on a worker that never
# saw the job and 404. Also keeps one copy of the torch/embedding stack in RAM.
exec python -m uvicorn api.main:app \
    --host 0.0.0.0 \
    --port "${PORT:-8002}" \
    --workers "${UVICORN_WORKERS:-1}"
