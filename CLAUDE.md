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
