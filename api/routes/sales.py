"""
api/routes/sales.py — Sales pipeline tracker.

Prefix /sales set in main.py.

Endpoints:
    GET    /sales/targets                        — list targets (stage, assigned_to, q filters)
    POST   /sales/targets                        — create target
    GET    /sales/targets/{id}                   — detail + contacts + notes
    PATCH  /sales/targets/{id}                   — update fields
    DELETE /sales/targets/{id}                   — hard delete

    POST   /sales/targets/{id}/advance           — validate gate + advance stage
    POST   /sales/targets/{id}/lose              — move to closed_lost

    GET    /sales/targets/{id}/contacts
    POST   /sales/targets/{id}/contacts
    DELETE /sales/targets/{id}/contacts/{contact_id}

    GET    /sales/targets/{id}/notes
    POST   /sales/targets/{id}/notes

    POST   /sales/targets/{id}/skirmish          — create a skirmish from this target

    POST   /sales/partners/{partner_id}/archive  — archive a partner as closed_lost target

    GET    /sales/pipeline-summary               — homepage widget data
    GET    /sales/leaderboard                    — per-salesperson contracted, stage counts, weekly deltas, stale count
"""

import json

from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg2.extras import Json, RealDictCursor
from pydantic import BaseModel

from api.routes.auth import UserInfo, require_jwt
from core.db.connection import get_connection

router = APIRouter()

_STAGE_ORDER = ["target", "nurturing", "proposal", "closed_won"]
_ALL_STAGES  = _STAGE_ORDER + ["closed_lost"]


# ── Pydantic models ───────────────────────────────────────────────────────────

class TargetCreate(BaseModel):
    company_name:   str
    website:        str | None = None
    sector:         str | None = None
    assigned_to:    str | None = None
    rationale:      str | None = None
    est_deal_type:  str | None = None
    est_deal_value: float | None = None
    target_close_date: str | None = None


class TargetUpdate(BaseModel):
    company_name:         str | None   = None
    website:              str | None   = None
    sector:               str | None   = None
    assigned_to:          str | None   = None
    rationale:            str | None   = None
    est_deal_type:        str | None   = None
    est_deal_value:       float | None = None
    target_close_date:    str | None   = None
    signed_date:          str | None   = None
    contract_value:       float | None = None
    contract_term_months: int | None   = None
    proposed_deliverables: list[str] | None = None
    stage_gate_data:      dict | None  = None
    stage:                str | None   = None


class AdvanceBody(BaseModel):
    gate_data: dict = {}


class LoseBody(BaseModel):
    reason:  str
    notes:   str | None = None


class ContactCreate(BaseModel):
    full_name:        str
    title:            str | None = None
    email:            str | None = None
    phone:            str | None = None
    is_decision_maker: bool = False


class NoteCreate(BaseModel):
    note_type:             str            = "general"
    body:                  str
    author:                str | None  = None
    # Structured meeting-note fields (populated when note_type='meeting')
    meeting_date:          str | None  = None
    tech_interest:         str | None  = None
    tech_challenge:        str | None  = None
    rating_buying_intent:  int | None  = None
    rating_dm_access:      int | None  = None
    rating_budget_fit:     int | None  = None
    rating_strategic_fit:  int | None  = None
    rating_timeline:       int | None  = None
    personal_note:         str | None  = None
    transcript_text:       str | None  = None


class SkirmishFromTarget(BaseModel):
    title:          str
    service_type:   str = "other"
    priority:       str = "medium"
    description:    str | None = None
    service_fields: dict | None = None
    created_by:     str | None = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _serialize_row(r: dict) -> dict:
    out = dict(r)
    for k, v in out.items():
        if hasattr(v, 'isoformat'):
            out[k] = v.isoformat()
    # jsonb already deserialized by RealDictCursor
    return out


def _fetch_target(cur, target_id: int) -> dict:
    cur.execute(
        "SELECT * FROM cvc.sales_targets WHERE id = %s",
        (target_id,),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Sales target not found")
    return dict(row)


# ── Targets ───────────────────────────────────────────────────────────────────

@router.get("/targets")
def list_targets(
    stage:       str | None = Query(None),
    assigned_to: str | None = Query(None),
    q:           str | None = Query(None),
    user: UserInfo = Depends(require_jwt),
):
    conditions = ["1=1"]
    params: list = []

    if stage:
        conditions.append("stage = %s")
        params.append(stage)
    if assigned_to:
        conditions.append("assigned_to = %s")
        params.append(assigned_to)
    if q:
        conditions.append("company_name ILIKE %s")
        params.append(f"%{q}%")

    where = " AND ".join(conditions)

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f"""
                SELECT id, company_name, website, sector, assigned_to, stage,
                       rationale, est_deal_type, est_deal_value, target_close_date,
                       signed_date, contract_value, contract_term_months,
                       proposed_deliverables, stage_gate_data, partner_id,
                       created_by, created_at, updated_at, stage_changed_at,
                       linked_target_id
                FROM cvc.sales_targets
                WHERE {where}
                ORDER BY
                    CASE stage
                        WHEN 'proposal'    THEN 0
                        WHEN 'nurturing'   THEN 1
                        WHEN 'target'      THEN 2
                        WHEN 'closed_won'  THEN 3
                        WHEN 'closed_lost' THEN 4
                    END,
                    stage_changed_at DESC
            """, params)
            rows = cur.fetchall()

    return [_serialize_row(dict(r)) for r in rows]


@router.post("/targets", status_code=201)
def create_target(body: TargetCreate, user: UserInfo = Depends(require_jwt)):
    if not body.company_name.strip():
        raise HTTPException(400, "company_name is required")

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO cvc.sales_targets
                    (company_name, website, sector, assigned_to, rationale,
                     est_deal_type, est_deal_value, target_close_date, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (
                body.company_name.strip(),
                body.website,
                body.sector,
                body.assigned_to,
                body.rationale,
                body.est_deal_type,
                body.est_deal_value,
                body.target_close_date,
                user.username,
            ))
            row = cur.fetchone()
            # Auto-enroll in news watch list (populated by news intelligence plugin — skip if not installed)
            try:
                cur.execute("""
                    INSERT INTO cvc.news_watch_companies (company_name, category)
                    VALUES (%s, 'sales')
                    ON CONFLICT (company_name, category) DO NOTHING
                """, (body.company_name.strip(),))
            except Exception:
                conn.rollback()
            conn.commit()

    return _serialize_row(dict(row))


@router.get("/targets/{target_id}")
def get_target(target_id: int, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM cvc.sales_targets WHERE id = %s", (target_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "Sales target not found")
            target = _serialize_row(dict(row))

            cur.execute("""
                SELECT id, full_name, title, email, phone, is_decision_maker, created_at
                FROM cvc.sales_contacts WHERE target_id = %s ORDER BY is_decision_maker DESC, created_at
            """, (target_id,))
            contacts = [_serialize_row(dict(r)) for r in cur.fetchall()]

            cur.execute("""
                SELECT id, note_type, body, author, created_at
                FROM cvc.sales_notes WHERE target_id = %s ORDER BY created_at DESC LIMIT 20
            """, (target_id,))
            notes = [_serialize_row(dict(r)) for r in cur.fetchall()]

    target["contacts"] = contacts
    target["notes"]    = notes
    return target


@router.patch("/targets/{target_id}")
def update_target(target_id: int, body: TargetUpdate, user: UserInfo = Depends(require_jwt)):
    updates: dict = {}
    if body.company_name is not None:
        updates["company_name"] = body.company_name.strip()
    if body.website is not None:
        updates["website"] = body.website
    if body.sector is not None:
        updates["sector"] = body.sector
    if body.assigned_to is not None:
        updates["assigned_to"] = body.assigned_to
    if body.rationale is not None:
        updates["rationale"] = body.rationale
    if body.est_deal_type is not None:
        updates["est_deal_type"] = body.est_deal_type
    if body.est_deal_value is not None:
        updates["est_deal_value"] = body.est_deal_value
    if body.target_close_date is not None:
        updates["target_close_date"] = body.target_close_date or None
    if body.signed_date is not None:
        updates["signed_date"] = body.signed_date or None
    if body.contract_value is not None:
        updates["contract_value"] = body.contract_value
    if body.contract_term_months is not None:
        updates["contract_term_months"] = body.contract_term_months
    if body.proposed_deliverables is not None:
        updates["proposed_deliverables"] = body.proposed_deliverables
    if body.stage is not None:
        if body.stage not in _ALL_STAGES:
            raise HTTPException(400, f"Invalid stage '{body.stage}'")
        updates["stage"] = body.stage
        updates["stage_changed_at"] = "NOW()"

    # stage_gate_data: merge with existing rather than replace
    if body.stage_gate_data is not None:
        updates["__merge_stage_gate_data__"] = body.stage_gate_data

    if not updates:
        raise HTTPException(400, "No fields to update")

    updates["updated_at"] = "NOW()"
    set_parts = []
    params = []
    import json as _json
    merge_gate = updates.pop("__merge_stage_gate_data__", None)
    if merge_gate is not None:
        set_parts.append("stage_gate_data = COALESCE(stage_gate_data, '{}'::jsonb) || %s::jsonb")
        params.append(_json.dumps(merge_gate))
    for k, v in updates.items():
        if v == "NOW()":
            set_parts.append(f"{k} = NOW()")
        else:
            set_parts.append(f"{k} = %s")
            params.append(v)

    params.append(target_id)

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"UPDATE cvc.sales_targets SET {', '.join(set_parts)} WHERE id = %s RETURNING *",
                params,
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "Sales target not found")
            conn.commit()

    return _serialize_row(dict(row))


@router.delete("/targets/{target_id}", status_code=204)
def delete_target(target_id: int, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM cvc.sales_targets WHERE id = %s RETURNING id", (target_id,))
            if not cur.fetchone():
                raise HTTPException(404, "Sales target not found")
            conn.commit()
    return None


# ── Stage advancement ─────────────────────────────────────────────────────────

@router.post("/targets/{target_id}/advance")
def advance_stage(target_id: int, body: AdvanceBody, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            target = _fetch_target(cur, target_id)

            current = target["stage"]
            if current not in _STAGE_ORDER:
                raise HTTPException(400, f"Cannot advance from stage '{current}'")

            idx = _STAGE_ORDER.index(current)
            if idx >= len(_STAGE_ORDER) - 1:
                raise HTTPException(400, "Already at the final stage (closed_won)")

            next_stage = _STAGE_ORDER[idx + 1]
            gate       = body.gate_data
            missing    = []

            # ── Gate validation ───────────────────────────────────────────────
            if next_stage == "nurturing":
                if not (gate.get("corporate_interests") or "").strip():
                    missing.append("corporate_interests (what the company is interested in)")
                if not (gate.get("outreach_date") or "").strip():
                    missing.append("outreach_date (when first contact was made)")
                # Check at least 1 contact
                cur.execute("SELECT COUNT(*) AS n FROM cvc.sales_contacts WHERE target_id = %s", (target_id,))
                if cur.fetchone()["n"] == 0:
                    missing.append("at least one contact in the Contacts tab")

            elif next_stage == "proposal":
                if not (gate.get("tech_interests") or "").strip():
                    missing.append("tech_interests (which technologies or sectors they care about)")
                if not gate.get("decision_maker_confirmed"):
                    missing.append("decision_maker_confirmed must be true")
                # Check at least 1 note
                cur.execute("SELECT COUNT(*) AS n FROM cvc.sales_notes WHERE target_id = %s", (target_id,))
                if cur.fetchone()["n"] == 0:
                    missing.append("at least one note logged in the Notes tab")

            elif next_stage == "closed_won":
                if not (target.get("contract_value") or 0) > 0:
                    missing.append("contract_value (must be set and > 0 on the target)")
                if not target.get("signed_date"):
                    missing.append("signed_date (set the signed date on the target)")
                if not target.get("proposed_deliverables"):
                    missing.append("proposed_deliverables (select at least one deliverable)")

            if missing:
                detail = "Cannot advance stage. Missing requirements: " + "; ".join(missing)
                raise HTTPException(400, detail)

            # ── Merge gate data ───────────────────────────────────────────────
            existing_gate = target.get("stage_gate_data") or {}
            if isinstance(existing_gate, str):
                existing_gate = json.loads(existing_gate)
            merged = {**existing_gate, **gate}

            cur.execute("""
                UPDATE cvc.sales_targets
                SET stage = %s, stage_changed_at = NOW(), stage_gate_data = %s, updated_at = NOW()
                WHERE id = %s
                RETURNING *
            """, (next_stage, Json(merged), target_id))
            row = cur.fetchone()
            conn.commit()

    return _serialize_row(dict(row))


@router.post("/targets/{target_id}/lose")
def lose_target(target_id: int, body: LoseBody, user: UserInfo = Depends(require_jwt)):
    if not body.reason.strip():
        raise HTTPException(400, "reason is required")

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            target = _fetch_target(cur, target_id)
            existing_gate = target.get("stage_gate_data") or {}
            if isinstance(existing_gate, str):
                existing_gate = json.loads(existing_gate)
            existing_gate["loss_reason"] = body.reason.strip()
            if body.notes:
                existing_gate["loss_notes"] = body.notes.strip()

            cur.execute("""
                UPDATE cvc.sales_targets
                SET stage = 'closed_lost', stage_changed_at = NOW(),
                    stage_gate_data = %s, updated_at = NOW()
                WHERE id = %s
                RETURNING *
            """, (Json(existing_gate), target_id))
            row = cur.fetchone()
            conn.commit()

    return _serialize_row(dict(row))


# ── Contacts ──────────────────────────────────────────────────────────────────

@router.get("/targets/{target_id}/contacts")
def list_contacts(target_id: int, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM cvc.sales_targets WHERE id = %s",
                (target_id,),
            )
            if not cur.fetchone():
                raise HTTPException(404, "Sales target not found")
            cur.execute("""
                SELECT id, full_name, title, email, phone, is_decision_maker, created_at
                FROM cvc.sales_contacts WHERE target_id = %s ORDER BY is_decision_maker DESC, created_at
            """, (target_id,))
            rows = cur.fetchall()
    return [_serialize_row(dict(r)) for r in rows]


@router.post("/targets/{target_id}/contacts", status_code=201)
def add_contact(target_id: int, body: ContactCreate, user: UserInfo = Depends(require_jwt)):
    if not body.full_name.strip():
        raise HTTPException(400, "full_name is required")

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT id FROM cvc.sales_targets WHERE id = %s", (target_id,))
            if not cur.fetchone():
                raise HTTPException(404, "Sales target not found")
            cur.execute("""
                INSERT INTO cvc.sales_contacts (target_id, full_name, title, email, phone, is_decision_maker)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (target_id, body.full_name.strip(), body.title, body.email, body.phone, body.is_decision_maker))
            row = cur.fetchone()
            conn.commit()

    return _serialize_row(dict(row))


@router.delete("/targets/{target_id}/contacts/{contact_id}", status_code=204)
def delete_contact(target_id: int, contact_id: int, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM cvc.sales_contacts WHERE id = %s AND target_id = %s RETURNING id",
                (contact_id, target_id),
            )
            if not cur.fetchone():
                raise HTTPException(404, "Contact not found")
            conn.commit()
    return None


# ── Notes ─────────────────────────────────────────────────────────────────────

@router.get("/targets/{target_id}/notes")
def list_notes(target_id: int, user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT id FROM cvc.sales_targets WHERE id = %s", (target_id,))
            if not cur.fetchone():
                raise HTTPException(404, "Sales target not found")
            cur.execute("""
                SELECT id, note_type, body, author, created_at,
                       meeting_date, tech_interest, tech_challenge,
                       rating_buying_intent, rating_dm_access, rating_budget_fit,
                       rating_strategic_fit, rating_timeline,
                       CASE WHEN author = %s THEN personal_note ELSE NULL END AS personal_note,
                       transcript_text
                FROM cvc.sales_notes WHERE target_id = %s ORDER BY created_at DESC
            """, (user.username, target_id,))
            rows = cur.fetchall()
    return [_serialize_row(dict(r)) for r in rows]


@router.post("/targets/{target_id}/notes", status_code=201)
def add_note(target_id: int, body: NoteCreate, user: UserInfo = Depends(require_jwt)):
    if not body.body.strip():
        raise HTTPException(400, "Note body is required")

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT id FROM cvc.sales_targets WHERE id = %s", (target_id,))
            if not cur.fetchone():
                raise HTTPException(404, "Sales target not found")
            cur.execute("""
                INSERT INTO cvc.sales_notes (
                    target_id, note_type, body, author,
                    meeting_date, tech_interest, tech_challenge,
                    rating_buying_intent, rating_dm_access, rating_budget_fit,
                    rating_strategic_fit, rating_timeline,
                    personal_note, transcript_text
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING id, note_type, body, author, created_at,
                          meeting_date, tech_interest, tech_challenge,
                          rating_buying_intent, rating_dm_access, rating_budget_fit,
                          rating_strategic_fit, rating_timeline,
                          personal_note, transcript_text
            """, (
                target_id, body.note_type, body.body.strip(), body.author or user.username,
                body.meeting_date, body.tech_interest, body.tech_challenge,
                body.rating_buying_intent, body.rating_dm_access, body.rating_budget_fit,
                body.rating_strategic_fit, body.rating_timeline,
                body.personal_note, body.transcript_text,
            ))
            row = cur.fetchone()
            conn.commit()

    return _serialize_row(dict(row))


# ── Skirmish from target ──────────────────────────────────────────────────────

@router.post("/targets/{target_id}/skirmish", status_code=201)
def create_skirmish_from_target(
    target_id: int,
    body: SkirmishFromTarget,
    user: UserInfo = Depends(require_jwt),
):
    _VALID_SERVICES   = {"dealflow", "intro", "trend_report", "innovation_day", "collection", "other"}
    _VALID_PRIORITIES = {"high", "medium", "low"}

    if body.service_type not in _VALID_SERVICES:
        raise HTTPException(400, f"Invalid service_type: {body.service_type}")
    if body.priority not in _VALID_PRIORITIES:
        raise HTTPException(400, f"Invalid priority: {body.priority}")
    if not body.title.strip():
        raise HTTPException(400, "Title is required")

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT id, company_name FROM cvc.sales_targets WHERE id = %s",
                (target_id,),
            )
            target = cur.fetchone()
            if not target:
                raise HTTPException(404, "Sales target not found")

            description_note = f"[Sales target: {target['company_name']} (id={target_id})]"
            if body.description:
                description_note = body.description.strip() + "\n" + description_note

            # Use structured service_fields if provided, else fall back to description blob
            sf = body.service_fields or {"description": description_note, "sales_target_id": target_id}
            sf.setdefault("sales_target_id", target_id)

            cur.execute("""
                INSERT INTO cvc.requests
                    (title, service_type, partner_name, priority, service_fields, created_by)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id, title, service_type, partner_id, partner_name,
                          status, priority, service_fields,
                          venture_assignment_id, created_by, created_at, updated_at
            """, (
                body.title.strip(),
                body.service_type,
                target["company_name"],
                body.priority,
                Json(sf),
                body.created_by or user.username,
            ))
            row = cur.fetchone()
            conn.commit()

    return {
        "id":           row["id"],
        "title":        row["title"],
        "service_type": row["service_type"],
        "partner_name": row["partner_name"],
        "status":       row["status"],
        "priority":     row["priority"],
        "created_by":   row["created_by"],
        "created_at":   row["created_at"].isoformat(),
    }


# ── Partner archive ───────────────────────────────────────────────────────────

@router.post("/partners/{partner_id}/archive", status_code=201)
def archive_partner_as_lost(
    partner_id: int,
    body: dict,
    user: UserInfo = Depends(require_jwt),
):
    reason      = (body.get("reason") or "").strip()
    assigned_to = (body.get("assigned_to") or user.username)
    if not reason:
        raise HTTPException(400, "reason is required")

    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT id, name, website, sector FROM cvc.partners WHERE id = %s",
                (partner_id,),
            )
            partner = cur.fetchone()
            if not partner:
                raise HTTPException(404, "Partner not found")

            gate_data = {"loss_reason": reason}

            cur.execute("""
                INSERT INTO cvc.sales_targets
                    (company_name, website, sector, assigned_to, stage, stage_gate_data,
                     partner_id, created_by, stage_changed_at)
                VALUES (%s, %s, %s, %s, 'closed_lost', %s, %s, %s, NOW())
                RETURNING *
            """, (
                partner["name"],
                partner.get("website"),
                partner.get("sector"),
                assigned_to,
                Json(gate_data),
                partner_id,
                user.username,
            ))
            row = cur.fetchone()
            conn.commit()

    return _serialize_row(dict(row))


# ── Pipeline summary (homepage widget) ───────────────────────────────────────

@router.get("/pipeline-summary")
def pipeline_summary(user: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Stage counts
            cur.execute("""
                SELECT stage, COUNT(*) AS n
                FROM cvc.sales_targets
                GROUP BY stage
            """)
            raw_counts = {r["stage"]: r["n"] for r in cur.fetchall()}
            stage_counts = {s: raw_counts.get(s, 0) for s in _ALL_STAGES}

            # Recent moves (last 7 stage changes)
            cur.execute("""
                SELECT id, company_name, assigned_to, stage, stage_changed_at
                FROM cvc.sales_targets
                ORDER BY stage_changed_at DESC
                LIMIT 7
            """)
            recent_moves = [_serialize_row(dict(r)) for r in cur.fetchall()]

            # Open skirmish count linked to sales (service_fields->sales_target_id set)
            cur.execute("""
                SELECT COUNT(*) AS n
                FROM cvc.requests
                WHERE status = 'open'
                  AND service_fields->>'sales_target_id' IS NOT NULL
            """)
            open_skirmish_count = cur.fetchone()["n"]

            # Top 3 open skirmishes linked to sales
            cur.execute("""
                SELECT id, title, partner_name, priority, created_at
                FROM cvc.requests
                WHERE status = 'open'
                  AND service_fields->>'sales_target_id' IS NOT NULL
                ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                         created_at DESC
                LIMIT 3
            """)
            top_skirmishes = [_serialize_row(dict(r)) for r in cur.fetchall()]

            # Bucket of Shame — all closed_lost targets
            cur.execute("""
                SELECT id, company_name, assigned_to, stage_changed_at
                FROM cvc.sales_targets
                WHERE stage = 'closed_lost'
                ORDER BY stage_changed_at DESC
            """)
            bucket_of_shame = [_serialize_row(dict(r)) for r in cur.fetchall()]

    return {
        "stage_counts":        stage_counts,
        "recent_moves":        recent_moves,
        "open_skirmish_count": open_skirmish_count,
        "top_skirmishes":      top_skirmishes,
        "bucket_of_shame":     bucket_of_shame,
    }


# ── Leaderboard ───────────────────────────────────────────────────────────────

@router.get("/leaderboard")
def leaderboard(user: UserInfo = Depends(require_jwt)):
    """
    Per-salesperson summary ordered by 2026 contracted value DESC.
    Queries:
      - stage_counts  — all targets by stage
      - contracted_2026 — SUM(contract_value) for closed_won targets where stage_changed_at is in 2026
      - weekly_delta  — net stage moves in last 7 days from sales_stage_history
      - stale_count   — active targets with stage_changed_at older than 21 days
    """
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:

            # 1. All salespeople with their stage counts
            cur.execute("""
                SELECT
                    assigned_to,
                    stage,
                    COUNT(*) AS n
                FROM cvc.sales_targets
                WHERE assigned_to IS NOT NULL
                GROUP BY assigned_to, stage
            """)
            stage_rows = cur.fetchall()

            # 2. Contracted 2026 (closed_won, stage_changed_at in 2026)
            cur.execute("""
                SELECT
                    assigned_to,
                    COALESCE(SUM(contract_value), 0) AS contracted_2026
                FROM cvc.sales_targets
                WHERE stage = 'closed_won'
                  AND EXTRACT(year FROM stage_changed_at) = 2026
                  AND assigned_to IS NOT NULL
                GROUP BY assigned_to
            """)
            contracted_rows = {r["assigned_to"]: float(r["contracted_2026"]) for r in cur.fetchall()}

            # 3. Weekly deltas from stage history (last 7 days)
            cur.execute("""
                SELECT
                    assigned_to,
                    new_stage,
                    old_stage,
                    COUNT(*) AS n
                FROM cvc.sales_stage_history
                WHERE changed_at >= NOW() - INTERVAL '7 days'
                  AND assigned_to IS NOT NULL
                GROUP BY assigned_to, new_stage, old_stage
            """)
            delta_rows = cur.fetchall()

            # 4. Stale counts (active stage, no movement in 21+ days)
            cur.execute("""
                SELECT
                    assigned_to,
                    COUNT(*) AS n
                FROM cvc.sales_targets
                WHERE stage NOT IN ('closed_won', 'closed_lost')
                  AND stage_changed_at < NOW() - INTERVAL '21 days'
                  AND assigned_to IS NOT NULL
                GROUP BY assigned_to
            """)
            stale_rows = {r["assigned_to"]: int(r["n"]) for r in cur.fetchall()}

    # ── Aggregate into per-person dicts ───────────────────────────────────────
    people: dict = {}

    for row in stage_rows:
        person = row["assigned_to"]
        if person not in people:
            people[person] = {
                "username": person,
                "contracted_2026": contracted_rows.get(person, 0.0),
                "stage_counts": {s: 0 for s in _ALL_STAGES},
                "weekly_delta": {s: 0 for s in _ALL_STAGES},
                "stale_count": stale_rows.get(person, 0),
            }
        people[person]["stage_counts"][row["stage"]] = int(row["n"])

    # Ensure any person only in contracted_rows or stale_rows is included
    for person in list(contracted_rows) + list(stale_rows):
        if person not in people:
            people[person] = {
                "username": person,
                "contracted_2026": contracted_rows.get(person, 0.0),
                "stage_counts": {s: 0 for s in _ALL_STAGES},
                "weekly_delta": {s: 0 for s in _ALL_STAGES},
                "stale_count": stale_rows.get(person, 0),
            }

    # Apply weekly deltas: for each history row, new_stage gets +n, old_stage gets -n
    for row in delta_rows:
        person = row["assigned_to"]
        if person not in people:
            people[person] = {
                "username": person,
                "contracted_2026": contracted_rows.get(person, 0.0),
                "stage_counts": {s: 0 for s in _ALL_STAGES},
                "weekly_delta": {s: 0 for s in _ALL_STAGES},
                "stale_count": stale_rows.get(person, 0),
            }
        n = int(row["n"])
        if row["new_stage"] in people[person]["weekly_delta"]:
            people[person]["weekly_delta"][row["new_stage"]] += n
        if row["old_stage"] in people[person]["weekly_delta"]:
            people[person]["weekly_delta"][row["old_stage"]] -= n

    result = sorted(people.values(), key=lambda x: x["contracted_2026"], reverse=True)
    return result
