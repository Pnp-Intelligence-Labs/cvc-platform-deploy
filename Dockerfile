FROM python:3.11-slim

# System deps: curl (healthchecks/debugging), libpq-dev (psycopg2 build),
# postgresql-client (psql, used by scripts/migrate.sh)
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl libpq-dev gcc postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN useradd --create-home --shell /bin/bash appuser

WORKDIR /app

# Install Python dependencies first (layer cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source (respects .dockerignore)
COPY . .

# Python can find both api/ and core/ as top-level packages
ENV PYTHONPATH=/app:/app/core

# Entrypoint
RUN chmod +x /app/scripts/docker_entrypoint.sh

USER appuser

EXPOSE 8002

CMD ["/app/scripts/docker_entrypoint.sh"]
