"""
api/routes/requests.py — Partner service project tracker (Requests).

Prefix /requests set in main.py.

Each request is a team project spawned from a partner service request.
PSMs create them via the Partner Terminal service modal; the whole ventures
team can be assigned, post updates, and track progress here.

Endpoints:
    GET    /requests                         — list (filters: status, service_type, partner_id)
    POST   /requests                         — create from service order
    GET    /requests/{id}                    — detail + assignees + updates
    PATCH  /requests/{id}                    — update status / priority / title
    POST   /requests/{id}/assignees          — add assignee
    DELETE /requests/{id}/assignees/{username} — remove assignee
    GET    /requests/{id}/updates            — list updates
    POST   /requests/{id}/updates            — add update
    POST   /documents/upload                   — upload PDF or DOCX
    GET    /documents/{doc_id}/download        — download uploaded document
"""

from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from psycopg2.extras import Json, RealDictCursor
from core.db.connection import get_connection
from api.routes.auth import require_jwt, UserInfo
from api.routes.notifications import write_notif
import io

router = APIRouter()

_VALID_STATUSES    = {"open", "active", "completed", "cancelled"}
_VALID_PRIORITIES  = {"high", "medium", "low"}
_VALID_SERVICES    = {"dealflow", "intro", "trend_report", "innovation_day", "other", "assignment", "collection"}


# ── Pydantic models ────────────────────────────────────────────────────────────

class SkirmishCreate(BaseModel):
    title:          str
    service_type:   str
    partner_id:     Optional[int]  = None
    partner_name:   Optional[str]  = None
    priority:       str            = "medium"
    service_fields: dict           = {}
    # Optional: link to the venture_assignment created at the same time
    venture_assignment_id: Optional[int] = None


class SkirmishUpdate(BaseModel):
    title:    Optional[str] = None
    status:   Optional[str] = None
    priority: Optional[str] = None


class AssigneeAdd(BaseModel):
    username: str


class UpdateCreate(BaseModel):
    body: str


class TaskCreate(BaseModel):
    title:       str
    assigned_to: Optional[str] = None

class TaskUpdate(BaseModel):
    title:       Optional[str]  = None
    assigned_to: Optional[str]  = None
    done:        Optional[bool] = None
    position:    Optional[int]  = None

class TaskReorder(BaseModel):
    order: list[int]  # list of task IDs in desired order


# ── Helpers ────────────────────────────────────────────────────────────────────

def _row_to_dict(r) -> dict:
    return {
        "id":                   r["id"],
        "title":                r["title"],
        "service_type":         r["service_type"],
        "partner_id":           r["partner_id"],
        "partner_name":         r["partner_name"],
        "status":               r["status"],
        "priority":             r["priority"],
        "service_fields":       r["service_fields"] or {},
        "outputs":              r["outputs"] or [],
        "venture_assignment_id": r["venture_assignment_id"],
        "created_by":           r["created_by"],
        "created_at":           r["created_at"].isoformat(),
        "updated_at":           r["updated_at"].isoformat(),
    }


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("")
def list_skirmishes(
    status:       Optional[str] = Query(None),
    service_type: Optional[str] = Query(None),
    partner_id:   Optional[int] = Query(None),
    assignee:     Optional[str] = Query(None),
    user: UserInfo = Depends(require_jwt),
):
    conditions = ["s.status != 'cancelled'"]
    params = []

    if status:
        conditions.append("s.status = %s")
        params.append(status)
    if service_type:
        conditions.append("s.service_type = %s")
        params.append(service_type)
    if partner_id:
        conditions.append("s.partner_id = %s")
        params.append(partner_id)
    if assignee:
        conditions.append(
            "EXISTS (SELECT 1 FROM cvc.request_assignees _a WHERE _a.request_id = s.id AND _a.username = %s)"
        )
        params.append(assignee)

    where = "WHERE " + " AND ".join(conditions)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT
                    s.id, s.title, s.service_type,
                    s.partner_id, COALESCE(s.partner_name, p.name) AS partner_name,
                    s.status, s.priority, s.service_fields, s.outputs,
                    s.venture_assignment_id, s.created_by, s.created_at, s.updated_at,
                    COALESCE(
                        array_agg(sa.username ORDER BY sa.assigned_at) FILTER (WHERE sa.username IS NOT NULL),
                        ARRAY[]::text[]
                    ) AS assignees,
                    (SELECT su.body FROM cvc.request_updates su
                     WHERE su.request_id = s.id ORDER BY su.created_at DESC LIMIT 1) AS last_update,
                    (SELECT COUNT(*) FROM cvc.request_updates su WHERE su.request_id = s.id) AS update_count
                FROM cvc.requests s
                LEFT JOIN cvc.partners p ON p.id = s.partner_id
                LEFT JOIN cvc.request_assignees sa ON sa.request_id = s.id
                {where}
                GROUP BY s.id, p.name
                ORDER BY
                    CASE s.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                    s.updated_at DESC
            """, params)
            rows = cur.fetchall()

    result = []
    for r in rows:
        d = _row_to_dict(r)
        d["assignees"]    = list(r["assignees"]) if r["assignees"] else []
        d["last_update"]  = r["last_update"]
        d["update_count"] = r["update_count"]
        result.append(d)

    return {"requests": result}


@router.post("", status_code=201)
def create_skirmish(body: SkirmishCreate, user: UserInfo = Depends(require_jwt)):
    if body.service_type not in _VALID_SERVICES:
        raise HTTPException(400, f"Invalid service_type: {body.service_type}")
    if body.priority not in _VALID_PRIORITIES:
        raise HTTPException(400, f"Invalid priority: {body.priority}")
    if not body.title.strip():
        raise HTTPException(400, "Title is required")

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO cvc.requests
                    (title, service_type, partner_id, partner_name, priority,
                     service_fields, venture_assignment_id, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, title, service_type, partner_id, partner_name,
                          status, priority, service_fields,
                          venture_assignment_id, created_by, created_at, updated_at
            """, (
                body.title.strip(), body.service_type,
                body.partner_id, body.partner_name,
                body.priority, Json(body.service_fields),
                body.venture_assignment_id, user.username,
            ))
            row = cur.fetchone()
            conn.commit()

    return _row_to_dict(row)



# ── Scrum (product ideas / PoCs / MVPs) ──────────────────────────────────────

class ScrumItemCreate(BaseModel):
    title:           str
    category:        Optional[str] = 'product'
    overview:        Optional[str] = None
    owner:           Optional[str] = None
    target_customer: Optional[str] = None
    revenue_model:   Optional[str] = None
    key_features:    Optional[str] = None
    platform_link:   Optional[str] = None
    status:          Optional[str] = 'exploring'

class ScrumItemUpdate(BaseModel):
    title:           Optional[str] = None
    category:        Optional[str] = None
    overview:        Optional[str] = None
    owner:           Optional[str] = None
    target_customer: Optional[str] = None
    revenue_model:   Optional[str] = None
    key_features:    Optional[str] = None
    platform_link:   Optional[str] = None
    status:          Optional[str] = None

class ScrumUpdateCreate(BaseModel):
    body: str


def _scrum_to_dict(r) -> dict:
    out = dict(r)
    for k, v in out.items():
        if hasattr(v, 'isoformat'):
            out[k] = v.isoformat()
    return out


@router.get("/scrum", response_model=list)
def list_scrum_items(user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT s.*,
                       (SELECT COUNT(*) FROM cvc.scrum_updates u WHERE u.item_id = s.id) AS update_count,
                       (SELECT u.body FROM cvc.scrum_updates u WHERE u.item_id = s.id ORDER BY u.created_at DESC LIMIT 1) AS last_update
                FROM cvc.scrum_items s
                ORDER BY s.created_at DESC
            """)
            return [_scrum_to_dict(r) for r in cur.fetchall()]


@router.post("/scrum", status_code=201)
def create_scrum_item(body: ScrumItemCreate, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO cvc.scrum_items
                    (title, category, overview, owner, target_customer, revenue_model,
                     key_features, platform_link, status, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (
                body.title, body.category, body.overview, body.owner,
                body.target_customer, body.revenue_model, body.key_features,
                body.platform_link, body.status, user.username,
            ))
            conn.commit()
            return _scrum_to_dict(cur.fetchone())


@router.get("/scrum/{item_id}")
def get_scrum_item(item_id: int, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM cvc.scrum_items WHERE id = %s", (item_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "Not found")
            item = _scrum_to_dict(row)
            cur.execute("""
                SELECT id, author, body, created_at
                FROM cvc.scrum_updates
                WHERE item_id = %s
                ORDER BY created_at ASC
            """, (item_id,))
            item['updates'] = [_scrum_to_dict(r) for r in cur.fetchall()]
            return item


@router.patch("/scrum/{item_id}")
def update_scrum_item(item_id: int, body: ScrumItemUpdate, user: UserInfo = Depends(require_jwt)):
    fields = {k: v for k, v in body.dict().items() if v is not None}
    if not fields:
        raise HTTPException(400, "Nothing to update")
    set_clause = ", ".join(f"{k} = %s" for k in fields)
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"UPDATE cvc.scrum_items SET {set_clause}, updated_at = NOW() WHERE id = %s RETURNING *",
                (*fields.values(), item_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "Not found")
            conn.commit()
            return _scrum_to_dict(row)


@router.delete("/scrum/{item_id}", status_code=204)
def delete_scrum_item(item_id: int, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM cvc.scrum_items WHERE id = %s RETURNING id", (item_id,))
            if not cur.fetchone():
                raise HTTPException(404, "Not found")
            conn.commit()


@router.get("/scrum/{item_id}/updates")
def list_scrum_updates(item_id: int, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, author, body, created_at
                FROM cvc.scrum_updates
                WHERE item_id = %s
                ORDER BY created_at ASC
            """, (item_id,))
            return [_scrum_to_dict(r) for r in cur.fetchall()]


@router.post("/scrum/{item_id}/updates", status_code=201)
def add_scrum_update(item_id: int, body: ScrumUpdateCreate, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "INSERT INTO cvc.scrum_updates (item_id, author, body) VALUES (%s, %s, %s) RETURNING *",
                (item_id, user.username, body.body),
            )
            conn.commit()
            return _scrum_to_dict(cur.fetchone())


# ── Feature Proposals ─────────────────────────────────────────────────────────

class ProposalCreate(BaseModel):
    title:               str
    what_to_build:       Optional[str] = None
    what_it_does:        Optional[str] = None
    why_we_want_it:      Optional[str] = None
    where_it_lives:      Optional[str] = None
    what_it_connects_to: Optional[str] = None


@router.get("/scrum/proposals/list", response_model=list)
def list_proposals(user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT p.*, s.title AS scrum_title
                FROM cvc.scrum_proposals p
                LEFT JOIN cvc.scrum_items s ON s.id = p.scrum_item_id
                ORDER BY
                    CASE WHEN p.status = 'pending' THEN 0 ELSE 1 END,
                    p.created_at DESC
            """)
            return [_scrum_to_dict(r) for r in cur.fetchall()]


@router.post("/scrum/proposals", status_code=201)
def create_proposal(body: ProposalCreate, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO cvc.scrum_proposals
                    (title, what_to_build, what_it_does, why_we_want_it,
                     where_it_lives, what_it_connects_to, submitted_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (
                body.title, body.what_to_build, body.what_it_does,
                body.why_we_want_it, body.where_it_lives,
                body.what_it_connects_to, user.username,
            ))
            conn.commit()
            return _scrum_to_dict(cur.fetchone())


@router.post("/scrum/proposals/{proposal_id}/convert", status_code=201)
def convert_proposal(proposal_id: int, user: UserInfo = Depends(require_jwt)):
    """Convert a feature proposal into a Scrum item. Pre-populates fields from the proposal."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM cvc.scrum_proposals WHERE id = %s", (proposal_id,))
            prop = cur.fetchone()
            if not prop:
                raise HTTPException(404, "Proposal not found")
            if prop["status"] == "converted":
                raise HTTPException(400, "Already converted")

            # Build overview from proposal fields
            parts = []
            if prop["what_to_build"]:
                parts.append(f"What to Build:\n{prop['what_to_build']}")
            if prop["what_it_does"]:
                parts.append(f"What It Should Do:\n{prop['what_it_does']}")
            if prop["why_we_want_it"]:
                parts.append(f"Why We Want It:\n{prop['why_we_want_it']}")
            overview = "\n\n".join(parts) if parts else None

            cur.execute("""
                INSERT INTO cvc.scrum_items
                    (title, category, overview, target_customer, key_features,
                     status, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (
                prop["title"],
                "product",
                overview,
                prop["where_it_lives"],
                prop["what_it_connects_to"],
                "exploring",
                user.username,
            ))
            item = _scrum_to_dict(cur.fetchone())

            cur.execute("""
                UPDATE cvc.scrum_proposals
                SET status = 'converted', scrum_item_id = %s, updated_at = NOW()
                WHERE id = %s
            """, (item["id"], proposal_id))
            conn.commit()
            return {"proposal_id": proposal_id, "scrum_item": item}


@router.delete("/scrum/proposals/{proposal_id}", status_code=204)
def dismiss_proposal(proposal_id: int, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE cvc.scrum_proposals SET status = 'dismissed', updated_at = NOW() WHERE id = %s RETURNING id",
                (proposal_id,),
            )
            if not cur.fetchone():
                raise HTTPException(404, "Proposal not found")
            conn.commit()


@router.get("/{skirmish_id}")
def get_skirmish(skirmish_id: int, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT s.id, s.title, s.service_type,
                       s.partner_id, COALESCE(s.partner_name, p.name) AS partner_name,
                       s.status, s.priority, s.service_fields, s.outputs,
                       s.venture_assignment_id, s.created_by, s.created_at, s.updated_at
                FROM cvc.requests s
                LEFT JOIN cvc.partners p ON p.id = s.partner_id
                WHERE s.id = %s
            """, (skirmish_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "Request not found")

            cur.execute("""
                SELECT username, assigned_by, assigned_at
                FROM cvc.request_assignees WHERE request_id = %s ORDER BY assigned_at
            """, (skirmish_id,))
            assignees = [{"username": r["username"], "assigned_by": r["assigned_by"],
                          "assigned_at": r["assigned_at"].isoformat()} for r in cur.fetchall()]

            cur.execute("""
                SELECT id, author, body, created_at
                FROM cvc.request_updates WHERE request_id = %s ORDER BY created_at DESC
            """, (skirmish_id,))
            updates = [{"id": r["id"], "author": r["author"], "body": r["body"],
                        "created_at": r["created_at"].isoformat()} for r in cur.fetchall()]

    result = _row_to_dict(row)
    result["assignees"] = assignees
    result["updates"]   = updates
    return result


@router.patch("/{skirmish_id}")
def update_skirmish(skirmish_id: int, body: SkirmishUpdate, user: UserInfo = Depends(require_jwt)):
    updates: dict = {}
    if body.title    is not None: updates["title"]    = body.title.strip()
    if body.status   is not None:
        if body.status not in _VALID_STATUSES:
            raise HTTPException(400, f"Invalid status: {body.status}")
        updates["status"] = body.status
    if body.priority is not None:
        if body.priority not in _VALID_PRIORITIES:
            raise HTTPException(400, f"Invalid priority: {body.priority}")
        updates["priority"] = body.priority

    if not updates:
        raise HTTPException(400, "No fields to update")

    set_clause = ", ".join(f"{k} = %s" for k in updates)
    values = list(updates.values()) + [skirmish_id]

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE cvc.requests SET {set_clause}, updated_at = NOW() WHERE id = %s RETURNING id",
                values,
            )
            if not cur.fetchone():
                raise HTTPException(404, "Request not found")
            conn.commit()

    return {"id": skirmish_id, "updated": True}


@router.post("/{skirmish_id}/assignees", status_code=201)
def add_assignee(skirmish_id: int, body: AssigneeAdd, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, title FROM cvc.requests WHERE id = %s", (skirmish_id,))
            skirmish = cur.fetchone()
            if not skirmish:
                raise HTTPException(404, "Request not found")
            cur.execute("""
                INSERT INTO cvc.request_assignees (request_id, username, assigned_by)
                VALUES (%s, %s, %s) ON CONFLICT DO NOTHING
            """, (skirmish_id, body.username, user.username))
            cur.execute("UPDATE cvc.requests SET updated_at = NOW() WHERE id = %s", (skirmish_id,))
            conn.commit()

    if body.username != user.username:
        write_notif(
            target_user=body.username,
            title=f"You've been added to: {skirmish['title']}",
            body=f"Added by {user.username}",
            link="/requests",
            source=user.username,
        )

    return {"skirmish_id": skirmish_id, "username": body.username}


@router.delete("/{skirmish_id}/assignees/{username}")
def remove_assignee(skirmish_id: int, username: str, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM cvc.request_assignees WHERE request_id = %s AND username = %s",
                (skirmish_id, username),
            )
            cur.execute("UPDATE cvc.requests SET updated_at = NOW() WHERE id = %s", (skirmish_id,))
            conn.commit()
    return {"removed": True}


@router.post("/{skirmish_id}/outputs", status_code=201)
def add_output(skirmish_id: int, body: dict, user: UserInfo = Depends(require_jwt)):
    """Append an output to a request. Body: {label, type, url, description?}"""
    label = (body.get("label") or "").strip()
    url   = (body.get("url") or "").strip()
    if not label or not url:
        raise HTTPException(400, "label and url are required")
    output_type = body.get("type", "url")
    if output_type not in ("pdf", "page", "url", "collection"):
        output_type = "url"
    entry = {"label": label, "type": output_type, "url": url}
    if body.get("description"):
        entry["description"] = body["description"].strip()

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT outputs FROM cvc.requests WHERE id = %s", (skirmish_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "Request not found")
            existing = row["outputs"] or []
            existing.append(entry)
            cur.execute(
                "UPDATE cvc.requests SET outputs = %s, updated_at = NOW() WHERE id = %s",
                (Json(existing), skirmish_id),
            )
            conn.commit()
    return {"ok": True, "output": entry}


@router.delete("/{skirmish_id}/outputs/{idx}")
def remove_output(skirmish_id: int, idx: int, user: UserInfo = Depends(require_jwt)):
    """Remove output at position idx."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT outputs FROM cvc.requests WHERE id = %s", (skirmish_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "Request not found")
            outputs = list(row["outputs"] or [])
            if idx < 0 or idx >= len(outputs):
                raise HTTPException(400, "Invalid output index")
            outputs.pop(idx)
            cur.execute(
                "UPDATE cvc.requests SET outputs = %s, updated_at = NOW() WHERE id = %s",
                (Json(outputs), skirmish_id),
            )
            conn.commit()
    return {"ok": True}


@router.get("/{skirmish_id}/updates")
def list_updates(skirmish_id: int, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, author, body, created_at FROM cvc.request_updates
                WHERE request_id = %s ORDER BY created_at DESC
            """, (skirmish_id,))
            rows = cur.fetchall()
    return {"updates": [{"id": r["id"], "author": r["author"], "body": r["body"],
                         "created_at": r["created_at"].isoformat()} for r in rows]}


@router.post("/{skirmish_id}/updates", status_code=201)
def add_update(skirmish_id: int, body: UpdateCreate, user: UserInfo = Depends(require_jwt)):
    if not body.body.strip():
        raise HTTPException(400, "Update body is required")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM cvc.requests WHERE id = %s", (skirmish_id,))
            if not cur.fetchone():
                raise HTTPException(404, "Request not found")
            cur.execute("""
                INSERT INTO cvc.request_updates (request_id, author, body)
                VALUES (%s, %s, %s) RETURNING id, created_at
            """, (skirmish_id, user.username, body.body.strip()))
            row = cur.fetchone()
            cur.execute("UPDATE cvc.requests SET updated_at = NOW() WHERE id = %s", (skirmish_id,))
            conn.commit()
    return {"id": row["id"], "author": user.username, "body": body.body.strip(),
            "created_at": row["created_at"].isoformat()}


# ── Document Upload ────────────────────────────────────────────────────────────

@router.post("/documents/upload", status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    source_label: Optional[str] = Form(None),
    user: UserInfo = Depends(require_jwt),
):
    allowed = (".pdf", ".docx")
    if not any(file.filename.lower().endswith(ext) for ext in allowed):
        raise HTTPException(status_code=400, detail="Only PDF or DOCX files are allowed")
    content = await file.read()
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """INSERT INTO cvc.request_documents (filename, file_type, file_data, source_label)
                   VALUES (%s, %s, %s, %s) RETURNING id, filename, source_label, uploaded_at""",
                (file.filename, file.content_type, content, source_label),
            )
            result = dict(cur.fetchone())
            conn.commit()
    result["url"] = f"/requests/documents/{result['id']}/download"
    return result


@router.get("/documents/{doc_id}/download")
def download_document(doc_id: int, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT filename, file_type, file_data FROM cvc.request_documents WHERE id = %s",
                (doc_id,),
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    filename, file_type, file_data = row
    return StreamingResponse(
        io.BytesIO(bytes(file_data)),
        media_type=file_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Request Tasks ──────────────────────────────────────────────────────────────

@router.get("/{request_id}/tasks")
def list_tasks(request_id: int, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT id FROM cvc.requests WHERE id = %s",
                (request_id,),
            )
            if not cur.fetchone():
                raise HTTPException(404, "Request not found")
            cur.execute("""
                SELECT id, request_id, title, assigned_to, done, position,
                       created_by, created_at, updated_at
                FROM cvc.request_tasks
                WHERE request_id = %s
                ORDER BY position ASC, id ASC
            """, (request_id,))
            rows = cur.fetchall()
    return [_task_to_dict(dict(r)) for r in rows]


@router.post("/{request_id}/tasks", status_code=201)
def create_task(request_id: int, body: TaskCreate, user: UserInfo = Depends(require_jwt)):
    if not body.title.strip():
        raise HTTPException(400, "title is required")
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT id FROM cvc.requests WHERE id = %s", (request_id,))
            if not cur.fetchone():
                raise HTTPException(404, "Request not found")
            # Position = current max + 1
            cur.execute(
                "SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM cvc.request_tasks WHERE request_id = %s",
                (request_id,),
            )
            pos = cur.fetchone()["pos"]
            cur.execute("""
                INSERT INTO cvc.request_tasks (request_id, title, assigned_to, position, created_by)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, request_id, title, assigned_to, done, position, created_by, created_at, updated_at
            """, (request_id, body.title.strip(), body.assigned_to, pos, user.username))
            row = cur.fetchone()
            conn.commit()
    return _task_to_dict(dict(row))


@router.patch("/{request_id}/tasks/{task_id}")
def update_task(request_id: int, task_id: int, body: TaskUpdate, user: UserInfo = Depends(require_jwt)):
    set_parts = []
    vals = []
    if body.title is not None:
        if not body.title.strip():
            raise HTTPException(400, "title cannot be empty")
        set_parts.append("title = %s"); vals.append(body.title.strip())
    if body.assigned_to is not None:
        set_parts.append("assigned_to = %s"); vals.append(body.assigned_to or None)
    if body.done is not None:
        set_parts.append("done = %s"); vals.append(body.done)
    if body.position is not None:
        set_parts.append("position = %s"); vals.append(body.position)
    if not set_parts:
        raise HTTPException(400, "Nothing to update")
    set_parts.append("updated_at = NOW()")
    vals.extend([request_id, task_id])
    completed_task = None
    next_task      = None

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"UPDATE cvc.request_tasks SET {', '.join(set_parts)} WHERE request_id = %s AND id = %s RETURNING *",
                vals,
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "Task not found")

            # If this update marks the task done, find the next undone task in position order
            if body.done is True:
                completed_task = dict(row)
                cur.execute("""
                    SELECT rt.id, rt.title, rt.assigned_to, r.title AS request_title
                    FROM cvc.request_tasks rt
                    JOIN cvc.requests r ON r.id = rt.request_id
                    WHERE rt.request_id = %s
                      AND rt.done = FALSE
                      AND rt.id != %s
                    ORDER BY rt.position ASC, rt.id ASC
                    LIMIT 1
                """, (request_id, task_id))
                next_task = cur.fetchone()

            conn.commit()

    # Notify the next person in the queue (outside the DB transaction)
    if next_task and next_task["assigned_to"] and next_task["assigned_to"] != user.username:
        write_notif(
            target_user=next_task["assigned_to"],
            title=f"Your task is up: {next_task['title']}",
            body=f"{user.username} completed the previous step on \"{next_task['request_title']}\"",
            link="/requests",
            source=user.username,
        )

    return _task_to_dict(dict(row))


@router.delete("/{request_id}/tasks/{task_id}", status_code=204)
def delete_task(request_id: int, task_id: int, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM cvc.request_tasks WHERE request_id = %s AND id = %s RETURNING id",
                (request_id, task_id),
            )
            if not cur.fetchone():
                raise HTTPException(404, "Task not found")
            conn.commit()


@router.post("/{request_id}/tasks/reorder", status_code=200)
def reorder_tasks(request_id: int, body: TaskReorder, user: UserInfo = Depends(require_jwt)):
    """Accepts ordered list of task IDs and sets position = index."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            for pos, task_id in enumerate(body.order):
                cur.execute(
                    "UPDATE cvc.request_tasks SET position = %s, updated_at = NOW() WHERE id = %s AND request_id = %s",
                    (pos, task_id, request_id),
                )
            conn.commit()
    return {"ok": True}


def _task_to_dict(r: dict) -> dict:
    out = dict(r)
    for k, v in out.items():
        if hasattr(v, 'isoformat'):
            out[k] = v.isoformat()
    return out

