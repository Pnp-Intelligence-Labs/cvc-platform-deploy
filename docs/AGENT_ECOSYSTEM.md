# CVC Agent Ecosystem
**Last updated: 2026-04-05**

---

## Overview

Nate runs Claw Venture Capital as a solo GP. To operate at the output level of a full team,
he built a multi-agent system across three machines connected via Tailscale.
Each agent has a specific role, a specific machine, and clear boundaries.

---

## The Machines

| Machine | Tailscale IP | Spec | SSH |
|---|---|---|---|
| Dell R620 (basement) | 100.83.104.117 | Ubuntu 24.04, user: nathan11 | `ssh nathan11@100.83.104.117` |
| Refinery (WSL2/Windows) | 100.114.250.70 | RTX 3090, 24GB VRAM | `ssh nathan@100.114.250.70` |
| Lenovo/Whip Claw (WSL2/Windows) | 100.74.101.77 | 16GB RAM | `ssh User@100.74.101.77` |
| Oracle Cloud | 100.84.215.64 | Linux | Real Claw only — separate project |

**Dell server details:**
- Hosts: BigBossHog, Big Claw, PostgreSQL, API, all task workers, all cron jobs
- Repo: `/home/nathan11/repos/cvc-intelligence`
- Python venv: `/home/nathan11/repos/cvc-intelligence/venv`
- Scripts: `/home/nathan11/scripts/`
- Logs: `/home/nathan11/logs/`
- Node.js 22 via nvm, OpenClaw 2026.3.13

**Refinery details:**
- Ollama ONLY — port 11434, models: qwen3:32b, qwen3.5:27b, deepseek-r1:32b
- No workers, no API, no agents run here
- All repos at `/home/nathan/repos/`
- Where Claude Code interactive sessions run

---

## The Agents

### BigBossHog — The Operator
- **Telegram:** @BigBossHogBot
- **Machine:** Dell server (100.83.104.117)
- **Model:** MiMo V2 Pro via OpenRouter
- **Role:** Publishes tasks to the build queue, deploys, tests, monitors health
- **Workspace:** `/home/nathan11/.openclaw/workspace/`
- **Does NOT:** Write code files

### Big Claw — The Builder
- **Telegram:** @BigMfinClawbot
- **Machine:** Dell server (100.83.104.117)
- **Model:** Kimi K2.5 / qwen3-235b via OpenRouter
- **Role:** Consumes task queue, writes code, tests locally, commits to GitHub
- **Workspace:** `/home/nathan11/.openclaw-bigclaw/workspace/`
- **Does NOT:** Deploy, access Lenovo, use Ollama for its own reasoning

### Whip Claw — The Watchdog
- **Telegram:** @WHIPCLAWBOT
- **Machine:** Lenovo (100.74.101.77)
- **Model:** Kimi K2.5 via OpenRouter
- **Role:** Documents all agent activity, monitors for errors, alerts Nate
- **Workspace:** `C:\Users\User\.openclaw\workspace\`
- **Does NOT:** Modify anything on other machines without Nate's approval

### Real Claw — Calgary Platform
- **Telegram:** @RealClawBot
- **Machine:** Oracle Cloud (100.84.215.64)
- **Role:** Calgary Development Intelligence Platform — completely independent from CVC operations

### Claude Code — Complex Architecture
- **Machine:** Refinery (interactive sessions only)
- **Role:** Complex platform architecture, migrations, infrastructure — Nate sessions only

---

## The Build Workflow (Task Queue)

```
BigBossHog publishes spec → cvc.build_tasks (status=pending)
  → Nate approves via /tasks-ui or POST /tasks/{id}/approve
  → task_worker.py (low risk) OR task_worker_agent.py (medium/high risk)
  → commits to GitHub
  → task_deployer.py: git pull locally + restart API + smoke test
  → auto-revert on failure, Telegram notify on all outcomes
  → Whip Claw documents throughout
```

**Risk routing:**
- `risk_level = 'low'` → task_worker.py (single LLM call, Kimi K2.5)
- `risk_level = 'medium'` or `'high'` → task_worker_agent.py (agentic loop, qwen3-235b)

**Division of labor — strictly enforced:**
- BigBossHog: publishes tasks, deploys, tests. DOES NOT write code.
- Big Claw: builds and commits. DOES NOT deploy or SSH to other machines.
- Whip Claw: monitors and documents. DOES NOT modify other agents without approval.
- Claude Code: architecture and complex platform work. Interactive sessions only.

---

## Inference Routing

| Agent | Model | Provider |
|---|---|---|
| BigBossHog | MiMo V2 Pro | OpenRouter |
| Big Claw (low risk tasks) | Kimi K2.5 | OpenRouter |
| Big Claw (med/high tasks) | qwen3-235b | OpenRouter |
| Whip Claw | Kimi K2.5 | OpenRouter |
| Batch enrichment | qwen3:32b | Ollama on Refinery (100.114.250.70:11434) |

**Rule:** No agent uses Ollama for its own reasoning. Ollama is batch enrichment only.

---

## Database

- **Host:** Dell server — `localhost` on server, `100.83.104.117` from anywhere else
- **DB:** cvc_db, user: producer
- **Schemas:** `cvc.*`, `trend_report.*`, `public.*`
- Full schema reference: `docs/SCHEMA.md`

---

## Critical Rules

- No agent modifies another agent's files without Nate's approval
- BigBossHog does NOT write code
- Big Claw does NOT deploy
- Whip Claw does NOT execute
- All agents use OpenRouter for primary inference — never local Ollama
- No em dashes in any generated content
- Brand: navy #253B49, yellow #F0E545, Trebuchet MS
