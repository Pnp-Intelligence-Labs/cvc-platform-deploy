"""
Sector Evaluation Framework — per-associate importance weights by sector + stage.

Privacy: individual weights are private. Team comparison is GP-only.
Budget: round(defaultCount × 2.5) pts across default fields. Each custom field adds 2.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from psycopg2.extras import Json as PsyJson

from api.auth import require_auth
from core.db.connection import get_connection

router = APIRouter()

SECTORS       = {'Robotics', 'Supply Chain', 'Manufacturing', 'Industrial Automation', 'Physical AI'}
STAGES        = {'Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C'}
SECTIONS      = {'Team', 'Market', 'Technology', 'Business'}
VENTURES_TEAM = ['nate', 'jerry', 'harvey', 'harshal', 'praj']
TOTAL_COMBOS  = len(SECTORS) * len(STAGES)  # 25 base combos


# ── Pydantic models ───────────────────────────────────────────────────────────

class FieldCreate(BaseModel):
    section: str
    field_name: str
    description: Optional[str] = None


class WeightItem(BaseModel):
    field_id: int
    importance: int   # 1–5


class WeightsSave(BaseModel):
    sector: str
    stage: str
    subsector: str = ''   # '' = base sector eval; non-empty = subsector-specific
    weights: list[WeightItem]


class SubsectorCreate(BaseModel):
    sector: str
    subsector: str


# ── Evaluation fields ─────────────────────────────────────────────────────────

@router.get("/fields")
def list_fields(user=Depends(require_auth)):
    """All default fields plus the current user's own custom fields."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, section, field_name, description, is_default, created_by
                FROM cvc.sector_eval_fields
                WHERE is_default = TRUE OR created_by = %s
                ORDER BY section, id
            """, (user['username'],))
            return [dict(r) for r in cur.fetchall()]


@router.post("/fields", status_code=201)
def create_field(body: FieldCreate, user=Depends(require_auth)):
    """Add a personal custom evaluation field. Only visible to the creator."""
    if body.section not in SECTIONS:
        raise HTTPException(400, f"section must be one of: {', '.join(sorted(SECTIONS))}")
    name = body.field_name.strip()
    if not name:
        raise HTTPException(400, "field_name is required")
    with get_connection() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute("""
                    INSERT INTO cvc.sector_eval_fields
                        (section, field_name, description, is_default, created_by)
                    VALUES (%s, %s, %s, FALSE, %s)
                    RETURNING id, section, field_name, description, is_default, created_by
                """, (body.section, name, body.description, user['username']))
                row = dict(cur.fetchone())
            except Exception as e:
                if 'unique' in str(e).lower():
                    raise HTTPException(409, "A field with that name already exists")
                raise
        conn.commit()
    return row


@router.delete("/fields/{field_id}", status_code=204)
def delete_field(field_id: int, user=Depends(require_auth)):
    """Delete a custom field. Default fields are permanent."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT is_default, created_by FROM cvc.sector_eval_fields WHERE id = %s",
                (field_id,)
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "Field not found")
            if row['is_default']:
                raise HTTPException(403, "Default fields cannot be deleted")
            if row['created_by'] != user['username'] and user.get('role') != 'GP':
                raise HTTPException(403, "Can only delete your own custom fields")
            cur.execute("DELETE FROM cvc.sector_eval_fields WHERE id = %s", (field_id,))
        conn.commit()


# ── Subsectors ────────────────────────────────────────────────────────────────

@router.get("/subsectors")
def list_subsectors(sector: str = Query(...), user=Depends(require_auth)):
    """All subsectors that have been created for a given sector by any user."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, sector, subsector, created_by
                FROM cvc.sector_eval_subsectors
                WHERE sector = %s
                ORDER BY subsector
            """, (sector,))
            return [dict(r) for r in cur.fetchall()]


@router.post("/subsectors", status_code=201)
def create_subsector(body: SubsectorCreate, user=Depends(require_auth)):
    """Register a new subsector for a sector.
    Visible to all users. Auto-creates a venture_assignment + linked request
    so the team can track per-subsector eval completion in Requests.
    """
    if body.sector not in SECTORS:
        raise HTTPException(400, "Invalid sector")
    name = body.subsector.strip()
    if not name:
        raise HTTPException(400, "subsector name is required")

    assignment_title = f"Evaluation by Sector: {name} ({body.sector})"

    with get_connection() as conn:
        with conn.cursor() as cur:
            # 1. Register subsector
            cur.execute("""
                INSERT INTO cvc.sector_eval_subsectors (sector, subsector, created_by)
                VALUES (%s, %s, %s)
                ON CONFLICT (sector, subsector)
                DO UPDATE SET sector = EXCLUDED.sector
                RETURNING id, sector, subsector, created_by
            """, (body.sector, name, user['username']))
            row = dict(cur.fetchone())

            # 2. Only create assignment if one doesn't already exist for this title
            cur.execute(
                "SELECT id FROM cvc.venture_assignments WHERE title = %s LIMIT 1",
                (assignment_title,)
            )
            if not cur.fetchone():
                # 3. Venture assignment
                cur.execute("""
                    INSERT INTO cvc.venture_assignments
                        (title, notes, source, assigned_users, created_by, status, priority)
                    VALUES (%s, %s, 'manual', %s, %s, 'open', 'medium')
                    RETURNING id
                """, (
                    assignment_title,
                    f"Rate evaluation criteria for {body.sector} → {name}. "
                    f"Open the Sector Evaluation form, select {body.sector} › {name}, "
                    f"and save your importance weights for each stage (Pre-seed through Series C).",
                    VENTURES_TEAM,
                    user['username'],
                ))
                va_id = cur.fetchone()['id']

                # 4. Linked request (skirmish) — service_fields carries sector+subsector for the UI
                cur.execute("""
                    INSERT INTO cvc.requests
                        (title, service_type, priority, service_fields, venture_assignment_id, created_by)
                    VALUES (%s, 'assignment', 'medium', %s, %s, %s)
                    RETURNING id
                """, (
                    assignment_title,
                    PsyJson({'sector': body.sector, 'subsector': name}),
                    va_id,
                    user['username'],
                ))
                request_id = cur.fetchone()['id']

                # 5. Add all ventures team as assignees
                for member in VENTURES_TEAM:
                    cur.execute("""
                        INSERT INTO cvc.request_assignees (request_id, username, assigned_by)
                        VALUES (%s, %s, %s) ON CONFLICT DO NOTHING
                    """, (request_id, member, user['username']))

        conn.commit()
    return row


@router.patch("/subsectors/{subsector_id}")
def rename_subsector(subsector_id: int, body: SubsectorCreate, user=Depends(require_auth)):
    """Rename a subsector. Creator or GP only. Updates the linked assignment + request titles."""
    name = body.subsector.strip()
    if not name:
        raise HTTPException(400, "subsector name is required")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT sector, subsector, created_by FROM cvc.sector_eval_subsectors WHERE id = %s",
                (subsector_id,)
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "Subsector not found")
            if row['created_by'] != user['username'] and user.get('role') != 'GP':
                raise HTTPException(403, "Only the creator can rename this subsector")

            old_name = row['subsector']
            s = row['sector']
            old_title = f"Evaluation by Sector: {old_name} ({s})"
            new_title = f"Evaluation by Sector: {name} ({s})"

            cur.execute("UPDATE cvc.sector_eval_subsectors SET subsector = %s WHERE id = %s", (name, subsector_id))
            cur.execute("UPDATE cvc.venture_assignments SET title = %s WHERE title = %s", (new_title, old_title))
            cur.execute("""
                UPDATE cvc.requests
                SET title = %s,
                    service_fields = service_fields || %s::jsonb
                WHERE title = %s
            """, (new_title, f'{{"subsector": "{name}"}}', old_title))
            cur.execute(
                "UPDATE cvc.sector_eval_weights SET subsector = %s WHERE sector = %s AND subsector = %s",
                (name, s, old_name)
            )
        conn.commit()
    return {"id": subsector_id, "sector": s, "subsector": name}


@router.delete("/subsectors/{subsector_id}", status_code=204)
def delete_subsector_route(subsector_id: int, user=Depends(require_auth)):
    """Delete a subsector + its linked assignment/request/weights. Creator or GP only."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT sector, subsector, created_by FROM cvc.sector_eval_subsectors WHERE id = %s",
                (subsector_id,)
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "Subsector not found")
            if row['created_by'] != user['username'] and user.get('role') != 'GP':
                raise HTTPException(403, "Only the creator can delete this subsector")

            name = row['subsector']
            s    = row['sector']
            assignment_title = f"Evaluation by Sector: {name} ({s})"

            # Delete linked request children then request
            cur.execute("""
                SELECT r.id FROM cvc.requests r WHERE r.title = %s LIMIT 1
            """, (assignment_title,))
            req_row = cur.fetchone()
            if req_row:
                rid = req_row['id']
                cur.execute("DELETE FROM cvc.request_assignees WHERE request_id = %s", (rid,))
                cur.execute("DELETE FROM cvc.request_updates WHERE request_id = %s", (rid,))
                cur.execute("DELETE FROM cvc.request_tasks WHERE request_id = %s", (rid,))
                cur.execute("DELETE FROM cvc.requests WHERE id = %s", (rid,))

            cur.execute("DELETE FROM cvc.venture_assignments WHERE title = %s", (assignment_title,))
            cur.execute(
                "DELETE FROM cvc.sector_eval_weights WHERE sector = %s AND subsector = %s",
                (s, name)
            )
            cur.execute("DELETE FROM cvc.sector_eval_subsectors WHERE id = %s", (subsector_id,))
        conn.commit()


# ── Weights ───────────────────────────────────────────────────────────────────

@router.get("/weights")
def get_weights(
    sector:    Optional[str] = Query(None),
    stage:     Optional[str] = Query(None),
    subsector: Optional[str] = Query(None),
    user=Depends(require_auth),
):
    """
    Get weights for the current user only (private).
    With sector+stage returns just that combo. Without filters returns all saved combos.
    subsector='' means the base sector evaluation (no subsector).
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            if sector and stage:
                sub = subsector if subsector is not None else ''
                cur.execute("""
                    SELECT field_id, importance, saved_at::text
                    FROM cvc.sector_eval_weights
                    WHERE evaluator = %s AND sector = %s AND subsector = %s AND stage = %s
                """, (user['username'], sector, sub, stage))
            else:
                cur.execute("""
                    SELECT field_id, importance, sector, subsector, stage, saved_at::text
                    FROM cvc.sector_eval_weights
                    WHERE evaluator = %s
                """, (user['username'],))
            return [dict(r) for r in cur.fetchall()]


@router.post("/weights")
def save_weights(body: WeightsSave, user=Depends(require_auth)):
    """Upsert importance weights for a sector+subsector+stage combo. Private to the user."""
    if body.sector not in SECTORS:
        raise HTTPException(400, "Invalid sector")
    if body.stage not in STAGES:
        raise HTTPException(400, "Invalid stage")
    if not body.weights:
        raise HTTPException(400, "weights list is empty")
    for w in body.weights:
        if not 1 <= w.importance <= 5:
            raise HTTPException(400, f"importance must be 1–5, got {w.importance}")

    with get_connection() as conn:
        with conn.cursor() as cur:
            for w in body.weights:
                cur.execute("""
                    INSERT INTO cvc.sector_eval_weights
                        (evaluator, sector, subsector, stage, field_id, importance, saved_at)
                    VALUES (%s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (evaluator, sector, subsector, stage, field_id)
                    DO UPDATE SET importance = EXCLUDED.importance, saved_at = NOW()
                """, (user['username'], body.sector, body.subsector, body.stage,
                      w.field_id, w.importance))
        conn.commit()
    return {"saved": len(body.weights), "sector": body.sector,
            "subsector": body.subsector, "stage": body.stage}


# ── Completion ────────────────────────────────────────────────────────────────

@router.get("/completion")
def get_completion(user=Depends(require_auth)):
    """All sector+subsector+stage combos the current user has saved."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT DISTINCT sector, subsector, stage, MAX(saved_at)::text AS last_saved
                FROM cvc.sector_eval_weights
                WHERE evaluator = %s
                GROUP BY sector, subsector, stage
            """, (user['username'],))
            return [dict(r) for r in cur.fetchall()]


@router.get("/team-completion")
def get_team_completion(
    sector:    Optional[str] = Query(None),
    subsector: Optional[str] = Query(None),
    user=Depends(require_auth),
):
    """
    Progress tracker for all ventures team members. Shows counts only, not weight values.
    No params → base 25-combo (all sectors × all stages) completion.
    sector + subsector → that subsector's 5-stage completion.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            if sector and subsector is not None:
                cur.execute("""
                    SELECT evaluator, COUNT(DISTINCT stage) AS completed
                    FROM cvc.sector_eval_weights
                    WHERE evaluator = ANY(%s) AND sector = %s AND subsector = %s
                    GROUP BY evaluator
                """, (VENTURES_TEAM, sector, subsector))
                total = len(STAGES)   # 5 stages
            else:
                cur.execute("""
                    SELECT evaluator, COUNT(DISTINCT (sector, stage)) AS completed
                    FROM cvc.sector_eval_weights
                    WHERE evaluator = ANY(%s) AND subsector = ''
                    GROUP BY evaluator
                """, (VENTURES_TEAM,))
                total = TOTAL_COMBOS  # 25
            rows = {r['evaluator']: int(r['completed']) for r in cur.fetchall()}
    return [
        {
            "evaluator": u,
            "completed": rows.get(u, 0),
            "total":     total,
            "pct":       round(rows.get(u, 0) / total * 100),
        }
        for u in VENTURES_TEAM
    ]


# ── Team comparison (GP only) ─────────────────────────────────────────────────

@router.get("/team")
def get_team_weights(
    sector:    str = Query(...),
    stage:     str = Query(...),
    subsector: str = Query(''),
    user=Depends(require_auth),
):
    """
    GP-only: all evaluators' weights for a sector+subsector+stage combo.
    Restricted to GP so associates cannot see each other's answers before submitting.
    """
    if user.get('role') != 'GP':
        raise HTTPException(403, "Team comparison is restricted to GP")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT w.evaluator, w.field_id, w.importance,
                       f.field_name, f.section
                FROM cvc.sector_eval_weights w
                JOIN cvc.sector_eval_fields f ON f.id = w.field_id
                WHERE w.sector = %s AND w.subsector = %s AND w.stage = %s
                ORDER BY f.section, f.id, w.evaluator
            """, (sector, subsector, stage))
            return [dict(r) for r in cur.fetchall()]
