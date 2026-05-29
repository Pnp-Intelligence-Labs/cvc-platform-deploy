# cvc-platform-deploy — Project Instructions

**This is NOT the production CVC platform.**
This repo is the generalized platform — **Plug and Play Vertical OS** — built for deployment to any VC team. Changes here do not affect the live CVC system.

## What This Repo Is

A clean, generalizable version of CVC Intelligence where we:
- Remove CVC-specific hardcoding (team names, sector focus, fund details)
- Build a plugin architecture so optional features ship separately
- Build the onboarding/install layer for new deployments
- Keep architecture clean per `docs/PHASE1_BUILD_PLAN.md` and `docs/DECISIONS.md`

**Production repo (do not touch from here):** `~/repos/cvc-intelligence` → `natelouie11-tech/NEW-CVC-REPO`
**This repo:** `~/repos/cvc-platform-deploy` → `natelouie11-tech/cvc-platform-deploy`

## Ground Rules

- Changes here are never pushed back to `cvc-intelligence` / `NEW-CVC-REPO`
- Do not SSH to the Dell server (100.83.104.117) — it runs production
- This is a Refinery-only workstream. Build, test, commit, push to `cvc-platform-deploy` only.

## Local Dev

```bash
bash scripts/run_local.sh        # starts PostgreSQL (Docker) + API (port 8002)
cd designs/figma-dashboard && npm run dev   # frontend dev server (port 5173)
```

Login: `nate` / `cvc2026`

## Whip Claw Deployment (100.74.101.77)

Live test deployment on Whip Claw WSL2. Access at **http://100.74.101.77:8002/app** (admin / changeme).

Repo lives at `/home/nathan/cvc-platform-deploy` in WSL2. SSH via `ssh User@100.74.101.77` lands on Windows shell — prefix all commands with `wsl`.

```bash
# Pull latest and restart API (run from Refinery):
ssh User@100.74.101.77 'wsl -- bash -c "cd /home/nathan/cvc-platform-deploy && GIT_SSH_COMMAND=\"ssh -i ~/.ssh/id_ed25519\" git pull origin main"'
# Then restart: pipe restart script via wsl tee and execute
```

DB password on Whip Claw: `platform_local` (matches run_local.sh hardcoded default).
`sudo` requires password on Whip Claw — cannot run over SSH. Deliver scripts via `cat script | ssh User@100.74.101.77 "wsl tee /tmp/script.sh"`.

`migrate.sh` fails loudly on existing DBs ("already exists" errors). Apply new migration files individually via psql rather than re-running the full script.

## Structure

```
├── api/              # FastAPI backend (port 8002)
├── core/             # Shared utilities
├── designs/          # React SPA (Vite + Tailwind)
├── workers/          # Background workers
├── plugins/_staging/ # Plugin code staged for packaging
├── docs/             # Architecture docs
├── onboarding/       # (building out) new team setup guide
├── config/           # (building out) env templates, team config
└── scripts/          # run_local.sh, migrate.sh, install.sh (building out)
```

## Key Docs

1. `docs/PHASE1_BUILD_PLAN.md` — auth + roles (Phase 1 complete)
2. `docs/DECISIONS.md` — key architecture decisions (do not re-litigate)
3. `PRODUCT_VISION.md` — what the platform is and does

## Git

- Remote: `https://github.com/natelouie11-tech/cvc-platform-deploy`
- Always pull before starting: `git pull origin main`
- Push here only: `git push origin main`

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
