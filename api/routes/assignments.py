"""
api/routes/assignments.py — Venture team assignments.

Prefix /ventures set in main.py.

Endpoints:
    GET  /ventures/assignments          — list open + in_progress assignments
    POST /ventures/assignments          — create a new assignment
    PATCH /ventures/assignments/{id}    — update status, assigned_users, notes, priority
"""


from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.routes.auth import UserInfo, require_jwt
from api.routes.notifications import write_notif
from core.db.connection import get_connection

router = APIRouter()

_VALID_STATUSES   = {"open", "in_progress", "completed", "cancelled"}
_VALID_PRIORITIES = {"high", "medium", "low"}
_ASSIGNABLE_ROLES = {"GP", "Principal", "Director"}


class AssignmentCreate(BaseModel):
    title:          str
    notes:          str | None = None
    partner_id:     int | None = None
    company_id:     int | None = None
    assigned_users: list[str] = []
    priority:       str = "medium"


class AssignmentUpdate(BaseModel):
    status:         str | None = None
    assigned_users: list[str] | None = None
    notes:          str | None = None
    priority:       str | None = None


@router.get("/assignments")
def list_assignments(user: UserInfo = Depends(require_jwt)):
    """Return all non-cancelled assignments, newest first. Includes linked request_id."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    va.id, va.title, va.notes, va.source,
                    va.partner_id,  p.name  AS partner_name,
                    va.company_id,  c.name  AS company_name,
                    va.assigned_users, va.status, va.priority,
                    va.created_by,  va.created_at, va.updated_at,
                    MIN(r.id) AS request_id,
                    COUNT(rt.id)                                    AS task_total,
                    COUNT(rt.id) FILTER (WHERE rt.done = true)      AS task_done
                FROM cvc.venture_assignments va
                LEFT JOIN cvc.partners      p  ON p.id  = va.partner_id
                LEFT JOIN cvc.companies     c  ON c.id  = va.company_id
                LEFT JOIN cvc.requests      r  ON r.venture_assignment_id = va.id
                LEFT JOIN cvc.request_tasks rt ON rt.request_id = r.id
                WHERE va.status != 'cancelled'
                GROUP BY va.id, p.name, c.name
                ORDER BY
                    CASE va.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                    va.created_at DESC
            """)
            rows = cur.fetchall()

    result = []
    for r in rows:
        result.append({
            "id":             r["id"],
            "title":          r["title"],
            "notes":          r["notes"],
            "source":         r["source"],
            "partner_id":     r["partner_id"],
            "partner_name":   r["partner_name"],
            "company_id":     r["company_id"],
            "company_name":   r["company_name"],
            "assigned_users": r["assigned_users"] or [],
            "status":         r["status"],
            "priority":       r["priority"],
            "created_by":     r["created_by"],
            "created_at":     r["created_at"].isoformat(),
            "updated_at":     r["updated_at"].isoformat(),
            "request_id":     r["request_id"],
            "task_total":     int(r["task_total"]),
            "task_done":      int(r["task_done"]),
        })
    return {"assignments": result}


@router.post("/assignments", status_code=201)
def create_assignment(body: AssignmentCreate, user: UserInfo = Depends(require_jwt)):
    """Create a new assignment. Any authenticated user can create."""
    if body.priority not in _VALID_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority: {body.priority}")
    if not body.title.strip():
        raise HTTPException(status_code=400, detail="Title is required")

    assigned_users = [u for u in body.assigned_users if u]

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO cvc.venture_assignments
                    (title, notes, partner_id, company_id, assigned_users, assigned_to, priority, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, title, notes, source, partner_id, company_id,
                          assigned_users, status, priority, created_by, created_at, updated_at
            """, (
                body.title.strip(), body.notes or None,
                body.partner_id, body.company_id,
                assigned_users,
                assigned_users[0] if assigned_users else None,  # keep assigned_to in sync
                body.priority, user.username,
            ))
            row = cur.fetchone()
            conn.commit()

    assignment_id  = row["id"]
    assignment_row = dict(row)
    assignment_row["assigned_users"] = assignment_row.get("assigned_users") or []

    # Auto-create a linked request so the assignment appears on the Requests page
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO cvc.requests
                    (title, service_type, priority, venture_assignment_id, created_by)
                VALUES (%s, 'assignment', %s, %s, %s)
                RETURNING id
            """, (body.title.strip(), body.priority, assignment_id, user.username))
            req_row = cur.fetchone()
            request_id = req_row["id"]
            # Add all assigned users to request_assignees
            for username in assigned_users:
                cur.execute("""
                    INSERT INTO cvc.request_assignees (request_id, username, assigned_by)
                    VALUES (%s, %s, %s) ON CONFLICT DO NOTHING
                """, (request_id, username, user.username))
            conn.commit()

    assignment_row["request_id"] = request_id

    # Notify all newly assigned users (except the creator)
    for username in assigned_users:
        if username != user.username:
            write_notif(
                target_user=username,
                title=f"You've been assigned: {body.title.strip()}",
                body=f"Assigned by {user.username}",
                link="/requests",
                source=user.username,
            )

    return assignment_row


@router.patch("/assignments/{assignment_id}")
def update_assignment(assignment_id: int, body: AssignmentUpdate, user: UserInfo = Depends(require_jwt)):
    """
    Update status, assigned_users, notes, or priority.
    - Any user can add themselves (pick up) to an assignment.
    - Only GP/Principal/Director can assign others.
    - Status transitions are open to all team members.
    """
    updates: dict = {}

    if body.status is not None:
        if body.status not in _VALID_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status: {body.status}")
        updates["status"] = body.status

    if body.assigned_users is not None:
        new_users = [u for u in body.assigned_users if u]
        # Allow self-assignment; assigning others requires Principal+ role
        others = [u for u in new_users if u != user.username]
        if others and user.role not in _ASSIGNABLE_ROLES:
            raise HTTPException(status_code=403, detail="Only GP/Principal/Director can assign to others")
        updates["assigned_users"] = new_users
        # Keep legacy assigned_to in sync (first user, or null)
        updates["assigned_to"] = new_users[0] if new_users else None

    if body.notes is not None:
        updates["notes"] = body.notes

    if body.priority is not None:
        if body.priority not in _VALID_PRIORITIES:
            raise HTTPException(status_code=400, detail=f"Invalid priority: {body.priority}")
        updates["priority"] = body.priority

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    # Fetch current state before update (for notification diff)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT title, assigned_users FROM cvc.venture_assignments WHERE id = %s",
                (assignment_id,),
            )
            current = cur.fetchone()
    if not current:
        raise HTTPException(status_code=404, detail="Assignment not found")

    prev_users = set(current["assigned_users"] or [])
    next_users = set(updates.get("assigned_users", prev_users))

    set_clause = ", ".join(f"{k} = %s" for k in updates)
    values = list(updates.values()) + [assignment_id]

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE cvc.venture_assignments SET {set_clause}, updated_at = NOW() WHERE id = %s RETURNING id",
                values,
            )
            row = cur.fetchone()
            conn.commit()

    if not row:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # Notify users newly added to this assignment
    newly_added = next_users - prev_users
    for username in newly_added:
        if username != user.username:
            write_notif(
                target_user=username,
                title=f"You've been assigned: {current['title']}",
                body=f"Assigned by {user.username}",
                link="/requests",
                source=user.username,
            )

    # Sync assignees to the linked request — replace atomically so removals take effect
    if "assigned_users" in updates:
        new_users_list = updates["assigned_users"]
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id FROM cvc.requests WHERE venture_assignment_id = %s LIMIT 1
                """, (assignment_id,))
                req = cur.fetchone()
                if req:
                    cur.execute(
                        "DELETE FROM cvc.request_assignees WHERE request_id = %s",
                        (req["id"],)
                    )
                    for username in new_users_list:
                        cur.execute("""
                            INSERT INTO cvc.request_assignees (request_id, username, assigned_by)
                            VALUES (%s, %s, %s) ON CONFLICT DO NOTHING
                        """, (req["id"], username, user.username))
                    cur.execute(
                        "UPDATE cvc.requests SET updated_at = NOW() WHERE id = %s",
                        (req["id"],),
                    )
                    conn.commit()

    return {"id": row["id"], "updated": True}
