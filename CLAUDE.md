# cvc-platform-deploy — Project Instructions

**This is NOT the production CVC platform.**
This repo is a working copy of the codebase used to strip CVC-specific features and generalize the platform for deployment to other teams. Changes here do not affect the live CVC system.

## What This Repo Is

A feature branch of CVC Intelligence where we:
- Remove CVC-specific hardcoding (team names, sector focus, fund details)
- Strip or modularize features that won't apply to other teams
- Build the onboarding/install layer for new deployments
- Keep the architecture clean per `docs/PHASE1_BUILD_PLAN.md` and `docs/DECISIONS.md`

**Production repo (do not touch from here):** `~/repos/cvc-intelligence` → `natelouie11-tech/NEW-CVC-REPO`
**This repo:** `~/repos/cvc-platform-deploy` → `natelouie11-tech/cvc-platform-deploy`

## Ground Rules

- Changes here are never pushed back to `cvc-intelligence` / `NEW-CVC-REPO`
- Do not SSH to the Dell server (100.83.104.117) to deploy anything from this repo — it runs production
- This is a Refinery-only workstream. Build, test, commit, push to `cvc-platform-deploy` only.
- Read `docs/PHASE1_BUILD_PLAN.md` before starting any stripping or refactor work

## Infrastructure (for reference — do not deploy here)

| Machine | IP | Role |
|---|---|---|
| Dell R620 | 100.83.104.117 | Production — runs live CVC platform. Off-limits for this workstream. |
| Refinery/WSL | 100.114.250.70 | Dev machine — this is where we work |

## Structure

Same as `cvc-intelligence` — full codebase copy as of 2026-05-19:

```
cvc-platform-deploy/
├── api/              # FastAPI backend (port 8001)
├── core/             # Shared utilities
├── designs/          # React SPA (Vite + Tailwind)
├── workers/          # Enrichment, scoring, DD, briefing workers
├── docs/             # Architecture docs + build plan + decisions log
├── onboarding/       # (building out) new team setup guide
├── config/           # (building out) env templates, seed data
└── scripts/          # (building out) install + setup scripts
```

## Key Docs to Read First

1. `docs/PHASE1_BUILD_PLAN.md` — what we're building and in what order
2. `docs/DECISIONS.md` — key architecture decisions already made (do not re-litigate)
3. `PRODUCT_VISION.md` — what the platform is and does

## Git

- Remote: `https://github.com/natelouie11-tech/cvc-platform-deploy`
- Always pull before starting: `git pull origin main`
- Push here only: `git push origin main`
