FROM python:3.11-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# System deps: curl (healthchecks/debugging), libpq-dev (psycopg2 build),
# postgresql-client (psql, used by scripts/migrate.sh)
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl libpq-dev gcc postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN useradd --create-home --shell /bin/bash appuser

WORKDIR /app

# Install Python dependencies first (layer cache)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Put the uv-managed venv on PATH so bare `python`/`uvicorn` (used by
# docker_entrypoint.sh) resolve to the venv interpreter with all deps.
# Without this, `python` is the system interpreter and imports fail.
ENV PATH="/app/.venv/bin:$PATH"

# Copy source (respects .dockerignore)
COPY . .

# Python can find both api/ and core/ as top-level packages
ENV PYTHONPATH=/app:/app/core

# Entrypoint
RUN chmod +x /app/scripts/docker_entrypoint.sh

# Drive ingest stages downloads under /app/workdir (DRIVE_WORKDIR default).
# COPY runs as root, so without this the non-root appuser can't mkdir it and
# every ingest fails with PermissionError. Disk here is cache-only (text
# persists in the DB), so an ephemeral container FS is fine.
RUN mkdir -p /app/workdir && chown -R appuser:appuser /app/workdir

USER appuser

EXPOSE 8002

CMD ["/app/scripts/docker_entrypoint.sh"]
