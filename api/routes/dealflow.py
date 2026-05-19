from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from pydantic import BaseModel
from typing import Optional, List
import os

from core.db.connection import get_connection
from api.auth import require_auth

router = APIRouter()


class StatusUpdateRequest(BaseModel):
    status: str
    reason: Optional[str] = None


class TermSheetRequest(BaseModel):
    investment_type: Optional[str] = None        # SAFE, convertible_note, equity, warrant
    round_type: Optional[str] = None
    check_size_usd: Optional[int] = None
    pre_money_valuation_usd: Optional[int] = None
    post_money_valuation_usd: Optional[int] = None
    round_size_usd: Optional[int] = None
    shares_purchased: Optional[int] = None
    pps_usd: Optional[float] = None
    stage_at_investment: Optional[str] = None
    lead_investor: Optional[str] = None
    revenue_at_investment_usd: Optional[int] = None
    fmv_usd: Optional[float] = None
    moic: Optional[float] = None
    fund: Optional[str] = None
    is_lead_investor: bool = False
    co_investors: Optional[List[str]] = None
    board_seat: bool = False
    pro_rata_rights: bool = False
    close_date: Optional[str] = None             # YYYY-MM-DD
    lead_attorney: Optional[str] = None
    notes: Optional[str] = None


class DealIntake(BaseModel):
    name: str
    company_id: Optional[int] = None   # if provided, skip name lookup and use this ID directly
    website: Optional[str] = None
    one_liner: Optional[str] = None
    sector: Optional[str] = None
    stage: Optional[str] = None
    pipeline_status: str = "discovered"
    notes: Optional[str] = None
    start_dd: bool = False


@router.get("/")
def list_dealflow(user=Depends(require_auth)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    c.id as company_id,
                    c.name,
                    c.sector,
                    c.stage,
                    cl.status,
                    cl.status_changed_at,
                    cl.reason,
                    cl.changed_by
                FROM cvc.companies c
                LEFT JOIN cvc.company_lifecycle cl ON c.id = cl.company_id
                ORDER BY
                    CASE cl.status
                        WHEN 'due_diligence' THEN 1
                        WHEN 'discovered'    THEN 2
                        WHEN 'invested'      THEN 3
                        WHEN 'passed'        THEN 4
                        ELSE 5
                    END,
                    c.name
            """)
            rows = cur.fetchall()
            return rows


_VENTURES_TEAM = ['harvey', 'jerry', 'praj', 'sterling']

@router.get("/leaderboard")
def dealflow_leaderboard(user=Depends(require_auth)):
    """2026 investment counts per ventures team member."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT changed_by, COUNT(*) AS investments
                FROM cvc.company_lifecycle
                WHERE status = 'invested'
                  AND status_changed_at >= '2026-01-01'
                  AND changed_by = ANY(%s)
                GROUP BY changed_by
            """, (_VENTURES_TEAM,))
            rows = {r["changed_by"]: int(r["investments"]) for r in cur.fetchall()}
    return [{"username": u, "investments": rows.get(u, 0)} for u in _VENTURES_TEAM]


@router.get("/stats")
def dealflow_stats(user=Depends(require_auth)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    COALESCE(status, 'discovered') as status,
                    COUNT(*) as count
                FROM cvc.company_lifecycle
                GROUP BY status
            """)
            return cur.fetchall()


@router.post("/intake")
def intake_deal(data: DealIntake, user=Depends(require_auth)):
    """Find or create a company, set its pipeline status, optionally queue a DD task."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            # Use provided company_id directly, or look up by name
            if data.company_id:
                cur.execute("SELECT id FROM cvc.companies WHERE id = %s", (data.company_id,))
                row = cur.fetchone()
            else:
                cur.execute("SELECT id FROM cvc.companies WHERE LOWER(name) = LOWER(%s)", (data.name.strip(),))
                row = cur.fetchone()
            existed = row is not None

            if existed:
                company_id = row["id"]
                # Update any provided fields
                updates, vals = [], []
                if data.website:   updates.append("website = %s");   vals.append(data.website.strip())
                if data.one_liner: updates.append("one_liner = %s"); vals.append(data.one_liner.strip())
                if data.sector:    updates.append("sector = %s");    vals.append(data.sector)
                if data.stage:     updates.append("stage = %s");     vals.append(data.stage)
                if updates:
                    vals.append(company_id)
                    cur.execute(f"UPDATE cvc.companies SET {', '.join(updates)} WHERE id = %s", vals)
            else:
                cur.execute("""
                    INSERT INTO cvc.companies (name, website, one_liner, sector, stage)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id
                """, (
                    data.name.strip(),
                    data.website.strip() if data.website else None,
                    data.one_liner.strip() if data.one_liner else None,
                    data.sector,
                    data.stage,
                ))
                company_id = cur.fetchone()["id"]

            # Upsert lifecycle status
            username = user.get("username", "nate") if isinstance(user, dict) else str(user)
            cur.execute("""
                INSERT INTO cvc.company_lifecycle (company_id, status, status_changed_at, changed_by, reason)
                VALUES (%s, %s, NOW(), %s, %s)
                ON CONFLICT (company_id) DO UPDATE SET
                    status = EXCLUDED.status,
                    status_changed_at = NOW(),
                    changed_by = EXCLUDED.changed_by,
                    reason = EXCLUDED.reason
            """, (company_id, data.pipeline_status, username, data.notes or None))

            # Optionally queue a DD task for BigBossHog
            dd_task_id = None
            if data.start_dd:
                spec = f"Run full DD pipeline for {data.name.strip()} (company_id={company_id})."
                cur.execute("""
                    INSERT INTO cvc.build_tasks
                        (spec, priority, risk_level, requires_approval, status, created_by, assigned_to, status_changed_at)
                    VALUES (%s, 'high', 'medium', TRUE, 'pending', 'nate', 'bigclaw', NOW())
                    RETURNING task_id
                """, (spec,))
                dd_task_id = cur.fetchone()["task_id"]

            conn.commit()
            return {"company_id": company_id, "existed": existed, "dd_task_id": dd_task_id}


@router.post("/upload/{company_id}")
async def upload_dataroom_files(
    company_id: int,
    files: List[UploadFile] = File(...),
    user=Depends(require_auth),
):
    """Write uploaded dataroom files to a staging directory on the server for DD processing."""
    staging_dir = os.path.abspath(f"/home/nathan11/dd_staging/{company_id}")
    os.makedirs(staging_dir, exist_ok=True)

    saved = []
    for f in files:
        content = await f.read()
        raw_name = f.filename or f"file_{len(saved)}"
        safe_name = os.path.basename(raw_name)
        if not safe_name or safe_name in {".", ".."}:
            raise HTTPException(status_code=400, detail="Invalid filename")
        dest = os.path.abspath(os.path.join(staging_dir, safe_name))
        if os.path.commonpath([staging_dir, dest]) != staging_dir:
            raise HTTPException(status_code=400, detail="Invalid filename")
        with open(dest, "wb") as fh:
            fh.write(content)
        saved.append({"filename": safe_name, "size": len(content)})

    return {"files": saved, "staging_dir": staging_dir}


@router.delete("/{company_id}")
def remove_from_pipeline(company_id: int, user=Depends(require_auth)):
    """Remove a company from the deal pipeline and clear its pending enrichment status."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM cvc.company_lifecycle WHERE company_id = %s", (company_id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Company not found in pipeline")
            # Also clear enrichment queue if it was pending
            cur.execute("""
                UPDATE cvc.companies SET enrichment_status = NULL, updated_at = NOW()
                WHERE id = %s AND enrichment_status = 'pending'
            """, (company_id,))
        conn.commit()
    return {"removed": True, "company_id": company_id}


@router.get("/{company_id}/term-sheet")
def get_term_sheet(company_id: int, user=Depends(require_auth)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM cvc.term_sheets WHERE company_id = %s", (company_id,))
            row = cur.fetchone()
            return row or {}


@router.post("/{company_id}/term-sheet")
def save_term_sheet(company_id: int, data: TermSheetRequest, user=Depends(require_auth)):
    """Upsert term sheet. On success, sets is_portfolio=TRUE and lifecycle status=invested."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM cvc.companies WHERE id = %s", (company_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Company not found")

            username = user.get("username", "nate") if isinstance(user, dict) else str(user)

            cur.execute("""
                INSERT INTO cvc.term_sheets (
                    company_id, investment_type, round_type, check_size_usd,
                    pre_money_valuation_usd, post_money_valuation_usd,
                    round_size_usd, shares_purchased, pps_usd,
                    stage_at_investment, lead_investor, revenue_at_investment_usd,
                    fmv_usd, moic, fund,
                    is_lead_investor, co_investors, board_seat, pro_rata_rights,
                    close_date, lead_attorney, notes, submitted_by, updated_at
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())
                ON CONFLICT (company_id) DO UPDATE SET
                    investment_type             = EXCLUDED.investment_type,
                    round_type                  = EXCLUDED.round_type,
                    check_size_usd              = EXCLUDED.check_size_usd,
                    pre_money_valuation_usd     = EXCLUDED.pre_money_valuation_usd,
                    post_money_valuation_usd    = EXCLUDED.post_money_valuation_usd,
                    round_size_usd              = EXCLUDED.round_size_usd,
                    shares_purchased            = EXCLUDED.shares_purchased,
                    pps_usd                     = EXCLUDED.pps_usd,
                    stage_at_investment         = EXCLUDED.stage_at_investment,
                    lead_investor               = EXCLUDED.lead_investor,
                    revenue_at_investment_usd   = EXCLUDED.revenue_at_investment_usd,
                    fmv_usd                     = EXCLUDED.fmv_usd,
                    moic                        = EXCLUDED.moic,
                    fund                        = EXCLUDED.fund,
                    is_lead_investor            = EXCLUDED.is_lead_investor,
                    co_investors                = EXCLUDED.co_investors,
                    board_seat                  = EXCLUDED.board_seat,
                    pro_rata_rights             = EXCLUDED.pro_rata_rights,
                    close_date                  = EXCLUDED.close_date,
                    lead_attorney               = EXCLUDED.lead_attorney,
                    notes                       = EXCLUDED.notes,
                    submitted_by                = EXCLUDED.submitted_by,
                    updated_at                  = NOW()
                RETURNING *
            """, (
                company_id,
                data.investment_type, data.round_type, data.check_size_usd,
                data.pre_money_valuation_usd, data.post_money_valuation_usd,
                data.round_size_usd, data.shares_purchased, data.pps_usd,
                data.stage_at_investment, data.lead_investor, data.revenue_at_investment_usd,
                data.fmv_usd, data.moic, data.fund,
                data.is_lead_investor, data.co_investors or [],
                data.board_seat, data.pro_rata_rights,
                data.close_date, data.lead_attorney, data.notes, username,
            ))
            sheet = cur.fetchone()

            # Set is_portfolio=TRUE, fund tag, and ensure lifecycle is invested
            fund_val = data.fund or 'Fund I'
            cur.execute(
                "UPDATE cvc.companies SET is_portfolio = TRUE, fund = %s, updated_at = NOW() WHERE id = %s",
                (fund_val, company_id,)
            )
            cur.execute("""
                INSERT INTO cvc.company_lifecycle (company_id, status, status_changed_at, changed_by)
                VALUES (%s, 'invested', NOW(), %s)
                ON CONFLICT (company_id) DO UPDATE SET
                    status = 'invested',
                    status_changed_at = NOW(),
                    changed_by = EXCLUDED.changed_by
            """, (company_id, username))

            conn.commit()
            return sheet


@router.post("/{company_id}/status")
def update_status(company_id: int, request: StatusUpdateRequest, user=Depends(require_auth)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM cvc.companies WHERE id = %s", (company_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Company not found")
            username = user.get("username", "system") if isinstance(user, dict) else str(user)
            cur.execute("""
                INSERT INTO cvc.company_lifecycle
                    (company_id, status, status_changed_at, changed_by, reason)
                VALUES
                    (%s, %s, NOW(), %s, %s)
                ON CONFLICT (company_id)
                DO UPDATE SET
                    status = EXCLUDED.status,
                    status_changed_at = NOW(),
                    changed_by = EXCLUDED.changed_by,
                    reason = EXCLUDED.reason
                RETURNING *
            """, (company_id, request.status, username, request.reason))
            result = cur.fetchone()
            conn.commit()
            return result
