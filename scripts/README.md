# scripts/

| Script | When to run |
|--------|-------------|
| `install.sh` | First-time setup on a new server |
| `run_local.sh` | Local dev — starts PostgreSQL + API with hot reload |
| `migrate.sh` | Apply pending DB migrations (safe to re-run) |
| `smoke_test.sh` | Post-deploy health check — verifies all core routes |
| `docker_entrypoint.sh` | Container entrypoint (not called directly) |
| `seed_demo.py` | Load 30 sample companies + partners for demos |
| `enrich_company_data.py` | One-off company enrichment pipeline |
