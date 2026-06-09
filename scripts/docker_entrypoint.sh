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
    if [ -z "${DB_PASSWORD:-}" ]; then
        echo "[entrypoint] FATAL: DB_PASSWORD must be set in production."
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

echo "[entrypoint] Waiting for database at ${DB_HOST}:${DB_PORT} ..."

MAX_WAIT=30
ELAPSED=0

until python -c "
import psycopg2, sys
try:
    psycopg2.connect(
        host='${DB_HOST}',
        port=${DB_PORT},
        dbname='${DB_NAME}',
        user='${DB_USER}',
        password='${DB_PASSWORD}'
    ).close()
except Exception as e:
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

echo "[entrypoint] Running migrations ..."
bash /app/scripts/migrate.sh

echo "[entrypoint] Starting API server ..."
exec python -m uvicorn api.main:app \
    --host 0.0.0.0 \
    --port 8002 \
    --workers 2
