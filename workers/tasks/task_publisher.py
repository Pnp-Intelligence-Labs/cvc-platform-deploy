"""
workers/tasks/task_publisher.py -- Create build tasks and trigger approval flow.

Usage:
    python3 workers/tasks/task_publisher.py --spec "Add subsector filter to /sourcing" --priority medium
    python3 workers/tasks/task_publisher.py --spec "..." --approve 42   # handle Telegram reply
"""
import argparse
import os
import sys
import requests

# Add repo root to path so db/connection works on Droplet
sys.path.insert(0, os.path.expanduser("~/repos/cvc-intelligence"))

for _env_path in [
    os.path.expanduser("~/repos/cvc-intelligence/.env"),
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env"),
]:
    if os.path.exists(_env_path):
        with open(_env_path) as _f:
            for _line in _f:
                _line = _line.strip()
                if _line and not _line.startswith("#") and "=" in _line:
                    _k, _v = _line.split("=", 1)
                    os.environ.setdefault(_k.strip(), _v.strip())
        break

from db.connection import get_connection

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_URL     = "https://openrouter.ai/api/v1/chat/completions"
ENRICH_MODEL       = "qwen/qwen3-8b"   # fast + cheap — just needs to parse and expand

REPO_CONTEXT = """
REPO: cvc-intelligence (FastAPI + React, Dell server 100.83.104.117, port 8001)

Key paths:
  api/main.py                          -- FastAPI app. Route prefixes set here ONLY.
  api/routes/companies.py              -- company CRUD, activity log, intel, funding rounds, deployments
  api/routes/enrichment.py            -- enrichment queue, quickadd, admin/activity-log
  api/routes/intelligence.py          -- briefings, signals
  api/routes/industrial.py            -- industrial matrix, sector data
  api/routes/tasks.py                 -- build_tasks queue API
  api/routes/home.py                  -- dashboard feed, home messages
  api/routes/partners.py              -- partner terminal, issues
  api/routes/dealflow.py              -- deal intake, pipeline
  api/routes/lp.py                    -- LP portal
  api/routes/portfolio.py             -- portfolio stats
  core/db/connection.py               -- get_connection() context manager
  core/db/migrations/                 -- SQL migrations (current highest: 056)
  designs/figma-dashboard/src/app/pages/   -- React pages (TSX)
  designs/figma-dashboard/src/app/components/ -- shared components
  workers/enrichment/                 -- nightly enrichment workers
  workers/dd/                         -- DD pipeline
  workers/briefing/                   -- weekly briefing pipeline
  workers/tasks/                      -- task queue workers

DB: PostgreSQL cvc_db, schema cvc
  Key tables: companies, funding_rounds, company_intel, intel_suggestions,
              company_activity_log, build_tasks, agent_memory, dd_evaluations,
              commercial_deployments, home_team_messages, briefing_items

Rules Big Claw must follow:
  - Route prefixes set in main.py include_router() ONLY — never in APIRouter()
  - Read existing files before writing
  - Run py_compile after every Python file
  - New migrations go in core/db/migrations/057_*.sql (increment from 056)
  - React build: cd designs/figma-dashboard && npm run build
  - After React build, commit api/static/app/ to git
"""

# ── Spec enrichment ───────────────────────────────────────────────────────────

def enrich_spec(raw_spec: str) -> str:
    """
    Call a fast LLM to expand the raw spec into a structured prompt for Big Claw.
    Returns the enriched spec, or the raw spec unchanged if the call fails.
    """
    if not OPENROUTER_API_KEY:
        return raw_spec

    system = (
        "You are BigBossHog, preparing a coding task for Big Claw — an automated agent "
        "that reads and writes code in the CVC Intelligence Platform.\n\n"
        "Given a raw task spec, expand it into a structured prompt Big Claw can execute "
        "without guessing. Include:\n"
        "1. FILES TO READ FIRST — specific file paths from the repo Big Claw must read "
        "before writing anything\n"
        "2. WHAT TO BUILD — clear description of the change with enough detail that Big Claw "
        "doesn't need to infer intent\n"
        "3. ACCEPTANCE CRITERIA — how to know it's done (e.g. endpoint returns X, "
        "component renders Y, migration applied)\n"
        "4. NOTES — any constraints, DB rules, or gotchas (e.g. migration needed, "
        "React build required, prefix rule)\n\n"
        "Keep it under 500 words. Do not invent file paths — only use paths from the repo "
        "context. Do not add a preamble."
    )

    user = f"{REPO_CONTEXT}\n\nRAW SPEC:\n{raw_spec}"

    try:
        resp = requests.post(
            OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": ENRICH_MODEL,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "max_tokens": 800,
            },
            timeout=30,
        )
        resp.raise_for_status()
        enriched = resp.json()["choices"][0]["message"]["content"].strip()
        return f"{raw_spec}\n\n---\n{enriched}"
    except Exception as e:
        print(f"[publisher] Spec enrichment failed (using raw spec): {e}")
        return raw_spec


def update_spec(task_id: int, enriched_spec: str):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE cvc.build_tasks SET spec = %s WHERE task_id = %s",
                (enriched_spec, task_id),
            )


# ── Risk classification ───────────────────────────────────────────────────────

HIGH_RISK_KEYWORDS = [
    "migration", "schema", "alter table", "drop table", "drop column",
    "create table", "auth", "credential", "password", "secret", "token",
    "deploy script", "update_api", "cron", "new pipeline", "new agent",
    "real claw", "oracle",
]

MEDIUM_RISK_KEYWORDS = [
    "new endpoint", "new route", "new page", "new worker",
    "add column", "index", "webhook",
]


def classify_risk(spec: str):
    spec_lower = spec.lower()
    for kw in HIGH_RISK_KEYWORDS:
        if kw in spec_lower:
            return "high", True
    for kw in MEDIUM_RISK_KEYWORDS:
        if kw in spec_lower:
            return "medium", True
    return "low", False


# ── DB operations ─────────────────────────────────────────────────────────────

def insert_task(spec: str, priority: str, risk_level: str,
                requires_approval: bool, created_by: str) -> int:
    status = "pending" if requires_approval else "approved"
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO cvc.build_tasks
                    (spec, priority, risk_level, requires_approval, status, created_by, assigned_to, status_changed_at)
                VALUES (%s, %s, %s, %s, %s, %s, 'bigclaw', NOW())
                RETURNING task_id
            """, (spec, priority, risk_level, requires_approval, status, created_by))
            row = cur.fetchone()
    return row["task_id"]


def auto_approve(task_id: int):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE cvc.build_tasks
                SET status = 'approved',
                    nate_approved_at = NOW(),
                    status_changed_at = NOW()
                WHERE task_id = %s AND status = 'pending'
            """, (task_id,))


def handle_approval_reply(task_id: int):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE cvc.build_tasks
                SET status = 'approved',
                    nate_approved_at = NOW(),
                    status_changed_at = NOW()
                WHERE task_id = %s AND status = 'pending'
                RETURNING task_id, spec
            """, (task_id,))
            row = cur.fetchone()
    if row:
        print(f"Task #{task_id} approved: {row['spec'][:80]}")
    else:
        print(f"Task #{task_id} not found or not in pending status.")


# ── Telegram ──────────────────────────────────────────────────────────────────

def notify_nate(task_id: int, spec: str, risk_level: str, auto_approved: bool):
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not bot_token or not chat_id:
        print("Warning: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set, skipping Telegram.")
        return

    if auto_approved:
        text = (
            f"Task #{task_id} queued (auto-approved, risk={risk_level}):\n"
            f"{spec[:120]}"
        )
    else:
        text = (
            f"Task #{task_id} needs your approval (risk={risk_level}):\n"
            f"{spec[:120]}\n\n"
            f"Reply: APPROVE {task_id}"
        )

    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    try:
        resp = requests.post(url, json={"chat_id": chat_id, "text": text}, timeout=10)
        resp.raise_for_status()
    except Exception as e:
        print(f"Telegram notify failed: {e}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="CVC task publisher")
    parser.add_argument("--spec", type=str, help="Task specification")
    parser.add_argument("--priority", type=str, default="medium",
                        choices=["low", "medium", "high"])
    parser.add_argument("--created-by", type=str, default="bigbosshog")
    parser.add_argument("--approve", type=int, metavar="TASK_ID",
                        help="Approve a pending task (called from Telegram handler)")
    args = parser.parse_args()

    if args.approve:
        handle_approval_reply(args.approve)
        return

    if not args.spec:
        parser.error("--spec is required when not using --approve")

    risk_level, requires_approval = classify_risk(args.spec)
    task_id = insert_task(args.spec, args.priority, risk_level,
                          requires_approval, args.created_by)

    # Enrich the spec with file paths, acceptance criteria, and context for Big Claw
    print(f"[publisher] Enriching spec for task #{task_id}...")
    enriched = enrich_spec(args.spec)
    if enriched != args.spec:
        update_spec(task_id, enriched)
        print(f"[publisher] Spec enriched.")

    if requires_approval:
        print(f"Task #{task_id} created (risk={risk_level}). Waiting for Nate's approval.")
        notify_nate(task_id, args.spec, risk_level, auto_approved=False)
    else:
        auto_approve(task_id)
        print(f"Task #{task_id} created and auto-approved (risk={risk_level}).")
        notify_nate(task_id, args.spec, risk_level, auto_approved=True)


if __name__ == "__main__":
    main()
