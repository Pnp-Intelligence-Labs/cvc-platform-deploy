# core/

Shared utility library used by `api/`, `workers/`, and plugins.
Import as `from core.<module> import ...`.

| Module | Purpose |
|--------|---------|
| `core/db/` | PostgreSQL connection pool, search, enrichment, ingest, migrations |
| `core/drive/` | Google Drive file browsing, pipeline, per-user OAuth |
| `core/llm/` | OpenRouter LLM client |
| `core/web/` | Brave search, ProxyCurl, web research, scraping |
| `core/pnpbert/` | PnP BERT embeddings engine (similarity search) |
| `core/storage.py` | MinIO object storage client |
| `core/notifications.py` | In-app notification dispatch |
| `core/job_logger.py` | Background job progress logging |
| `core/config_loader.py` | Runtime config (team.json + env vars) |
