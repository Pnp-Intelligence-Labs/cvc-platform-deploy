"""
api/routes/tasks.py -- Build task queue API endpoints.

Endpoints:
    GET  /tasks/stats           -- counts by status (for dashboard badges)
    GET  /tasks                 -- list all tasks, newest first
    GET  /tasks/{task_id}       -- single task detail
    POST /tasks/{task_id}/approve  -- approve a pending task
    POST /tasks                 -- create a new task
"""
import json
import os

import requests as _requests
from fastapi import APIRouter, BackgroundTasks, HTTPException, Depends
from typing import Optional
from pydantic import BaseModel
from datetime import datetime

from core.db.connection import get_connection
from api.routes.auth import require_jwt, UserInfo
from api.routes.notifications import write_notif

# ── Telegram config (BBH bot notifies Nate on task approval) ─────────────────
_BBH_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "8439605362:AAEs0kErefS7YL9JcAx4H_TpTSOSGiBgLrM")
_NATE_CHAT_ID  = os.environ.get("TELEGRAM_CHAT_ID", "8310039682")


def _telegram_notify(task_id: int, spec: str):
    """Fire-and-forget background task: BBH bot pings Nate when a task is approved."""
    if not _BBH_BOT_TOKEN or not _NATE_CHAT_ID:
        return
    msg = f"Task #{task_id} approved — Big Claw is on it.\n\n{spec[:300]}"
    try:
        _requests.post(
            f"https://api.telegram.org/bot{_BBH_BOT_TOKEN}/sendMessage",
            json={"chat_id": _NATE_CHAT_ID, "text": msg},
            timeout=8,
        )
    except Exception:
        pass

router = APIRouter()

_ADMIN_ROLES = {"GP", "Principal", "Director"}

# ── Risk classification (mirrors task_publisher.py) ───────────────────────────

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


# ── Models ────────────────────────────────────────────────────────────────────

class TaskCreate(BaseModel):
    spec: str
    priority: str = "medium"
    created_by: str = "nate"


class TaskOut(BaseModel):
    task_id: int
    spec: str
    priority: str
    risk_level: str
    requires_approval: bool
    status: str
    created_by: str
    assigned_to: str
    commit_hash: Optional[str] = None
    nate_approved_at: Optional[datetime] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    deployed_at: Optional[datetime] = None
    status_changed_at: datetime
    notes: Optional[str] = None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/stats")
async def get_task_stats():
    """Counts by status -- used by dashboard badge row."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT status, COUNT(*) as cnt
                FROM cvc.build_tasks
                WHERE task_type NOT IN ('dd', 'enrichment')
                GROUP BY status
            """)
            rows = cur.fetchall()
    counts = {r["status"]: r["cnt"] for r in rows}
    statuses = ["pending", "approved", "building", "complete", "deployed", "failed", "on_hold", "closed"]
    return {s: counts.get(s, 0) for s in statuses}


@router.get("/", response_model=list[TaskOut])
async def list_tasks(limit: int = 100, status: Optional[str] = None):
    """List tasks newest first, optionally filtered by status."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            if status:
                cur.execute("""
                    SELECT * FROM cvc.build_tasks
                    WHERE status = %s
                      AND task_type NOT IN ('dd', 'enrichment')
                    ORDER BY created_at DESC
                    LIMIT %s
                """, (status, limit))
            else:
                cur.execute("""
                    SELECT * FROM cvc.build_tasks
                    WHERE task_type NOT IN ('dd', 'enrichment')
                    ORDER BY created_at DESC
                    LIMIT %s
                """, (limit,))
            rows = cur.fetchall()
    return [TaskOut(**dict(r)) for r in rows]


@router.get("/feedback")
async def list_feedback_tasks(status: Optional[str] = None):
    """Return all [Dashboard Feedback] tasks, newest first."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            if status:
                cur.execute("""
                    SELECT * FROM cvc.build_tasks
                    WHERE spec LIKE '[Dashboard Feedback]%%'
                      AND status = %s
                    ORDER BY created_at DESC
                    LIMIT 200
                """, (status,))
            else:
                cur.execute("""
                    SELECT * FROM cvc.build_tasks
                    WHERE spec LIKE '[Dashboard Feedback]%%'
                    ORDER BY created_at DESC
                    LIMIT 200
                """)
            rows = cur.fetchall()
    return {"feedback": [dict(r) for r in rows]}


@router.get("/{task_id}", response_model=TaskOut)
async def get_task(task_id: int):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM cvc.build_tasks WHERE task_id = %s", (task_id,))
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    return TaskOut(**dict(row))


@router.post("/{task_id}/approve")
async def approve_task(task_id: int, background_tasks: BackgroundTasks, caller: UserInfo = Depends(require_jwt)):
    """Approve a pending task from the dashboard UI. Restricted to GP/Principal/Director."""
    if caller.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Task approval requires GP, Principal, or Director role")
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
                # Wake the task_worker_agent instantly — no polling needed
                cur.execute("SELECT pg_notify('task_approved', %s)",
                            (json.dumps({"task_id": row["task_id"]}),))
    if not row:
        raise HTTPException(status_code=404, detail="Task not found or not in pending status")
    background_tasks.add_task(_telegram_notify, row["task_id"], row["spec"])
    return {"task_id": row["task_id"], "status": "approved", "spec": row["spec"]}


@router.patch("/{task_id}/status")
async def update_task_status(task_id: int, body: dict, caller: UserInfo = Depends(require_jwt)):
    """Update feedback task status manually. Restricted to GP/Principal/Director.
    Allowed transitions: pending→received, received→complete (with optional note), any→closed.
    Fires a notification to the submitter on received and complete.
    """
    if caller.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Task status changes require GP, Principal, or Director role")
    new_status = body.get("status", "")
    note       = (body.get("note") or "").strip() or None
    allowed = {"closed", "on_hold", "pending", "received", "complete"}
    if new_status not in allowed:
        raise HTTPException(status_code=400, detail=f"status must be one of: {', '.join(sorted(allowed))}")

    with get_connection() as conn:
        with conn.cursor() as cur:
            # Fetch current row so we can notify the submitter
            cur.execute("SELECT task_id, status, created_by, spec FROM cvc.build_tasks WHERE task_id = %s", (task_id,))
            existing = cur.fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Task not found")

            update_fields = "status = %s, status_changed_at = NOW()"
            params = [new_status]
            if note:
                update_fields += ", notes = %s"
                params.append(note)
            params.append(task_id)

            cur.execute(f"""
                UPDATE cvc.build_tasks
                SET {update_fields}
                WHERE task_id = %s
                RETURNING task_id, status, created_by
            """, params)
            row = cur.fetchone()
        conn.commit()

    # Notify the submitter
    submitter = existing["created_by"]
    if submitter and new_status == "received":
        write_notif(
            target_user=submitter,
            title="Your feedback was received",
            body=f'"{existing["spec"][:120].split(chr(10))[-1].strip()}" — Nate has reviewed it and it\'s in the queue.',
            link="/admin?tab=system",
            source="feedback",
        )
    elif submitter and new_status == "complete":
        body_text = "Your feedback has been resolved."
        if note:
            body_text += f" Note: {note}"
        write_notif(
            target_user=submitter,
            title="Your feedback was completed",
            body=body_text,
            link="/admin?tab=system",
            source="feedback",
        )

    return {"task_id": row["task_id"], "status": row["status"]}


@router.post("/", response_model=TaskOut)
async def create_task(payload: TaskCreate):
    """Create a new task (Nate via dashboard). Auto-classifies risk."""
    if payload.priority not in ("low", "medium", "high"):
        raise HTTPException(status_code=400, detail="priority must be low/medium/high")

    # Feedback submissions always land in pending for review before BigBossHog sees them
    if payload.spec.startswith("[Dashboard Feedback]"):
        risk_level, requires_approval, status, task_type = "low", True, "pending", "feedback"
    else:
        risk_level, requires_approval = classify_risk(payload.spec)
        status = "pending" if requires_approval else "approved"
        task_type = None

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO cvc.build_tasks
                    (spec, priority, risk_level, requires_approval, status, created_by, assigned_to,
                     task_type, status_changed_at)
                VALUES (%s, %s, %s, %s, %s, %s, 'bigclaw', %s, NOW())
                RETURNING *
            """, (payload.spec, payload.priority, risk_level, requires_approval, status,
                  payload.created_by, task_type))
            row = cur.fetchone()
        conn.commit()
    return TaskOut(**dict(row))
