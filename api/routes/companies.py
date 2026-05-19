from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from typing import List, Optional
from pydantic import BaseModel
import json
import os
import io
import re
import requests
from datetime import datetime, timezone
from core.db.connection import get_connection
from api.auth import require_auth

router = APIRouter()


def _log_activity(cur, company_id: int, changed_by: str, field_name: str,
                  old_value: str | None, new_value: str | None, source: str = "manual"):
    """Insert one row into company_activity_log. Caller must commit."""
    cur.execute("""
        INSERT INTO cvc.company_activity_log
            (company_id, changed_by, field_name, old_value, new_value, change_source)
        VALUES (%s, %s, %s, %s, %s, %s)
    """, [company_id, changed_by, field_name, old_value, new_value, source])


class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    one_liner: Optional[str] = None
    description: Optional[str] = None
    website: Optional[str] = None
    linkedin_url: Optional[str] = None
    sector: Optional[str] = None
    secondary_sector: Optional[str] = None
    sector_confidence: Optional[int] = None
    sector_rationale: Optional[str] = None
    sector_reviewed_by: Optional[str] = None
    sector_reviewed_at: Optional[str] = None
    stage: Optional[str] = None
    hq_city: Optional[str] = None
    country: Optional[str] = None
    founded: Optional[int] = None
    employee_count: Optional[int] = None
    total_raised_usd: Optional[int] = None
    investors: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    env_4d: Optional[str] = None
    func_4d: Optional[str] = None
    stack_4d: Optional[str] = None
    biz_model_4d: Optional[str] = None
    background: Optional[str] = None
    competitive_advantage: Optional[str] = None
    case_study: Optional[str] = None
    industrial_readiness_score: Optional[float] = None
    sovereignty_score: Optional[float] = None
    protocol_support: Optional[List[str]] = None
    verified_certs: Optional[List[str]] = None
    deployment_signal_level: Optional[str] = None
    integration_notes: Optional[str] = None
    score_composite: Optional[float] = None
    score_commercial: Optional[float] = None
    score_technical: Optional[float] = None
    score_market_timing: Optional[float] = None
    score_partner_fit: Optional[float] = None
    score_capital_eff: Optional[float] = None
    commercial_signals: Optional[dict] = None
    revenue_arr_usd: Optional[int] = None
    revenue_period: Optional[str] = None
    revenue_source: Optional[str] = None


@router.get("/")
def search_companies(
    q: Optional[str] = None,
    sector: Optional[str] = None,
    stage: Optional[str] = None,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    name_only: bool = False,
    user=Depends(require_auth)
):
    """Search companies with optional filters.

    name_only=true restricts matching to the name field only (used by typeaheads).
    When q is provided, results are ranked: name-prefix matches first, then
    other name matches, then description/one_liner matches.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            conditions = ["1=1"]
            params = []

            if q:
                if name_only:
                    conditions.append("name ILIKE %s")
                    params.append(f"%{q}%")
                else:
                    conditions.append("(name ILIKE %s OR one_liner ILIKE %s OR description ILIKE %s)")
                    params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])

            if sector:
                conditions.append("sector = %s")
                params.append(sector)

            if stage:
                conditions.append("stage = %s")
                params.append(stage)

            where_clause = " AND ".join(conditions)

            # Rank order: name-prefix match → name-substring match → description match → score
            if q:
                order = """
                    CASE
                        WHEN name ILIKE %s THEN 0
                        WHEN name ILIKE %s THEN 1
                        ELSE 2
                    END,
                    score_composite DESC NULLS LAST, name ASC
                """
                order_params = [f"{q}%", f"%{q}%"]
            else:
                order = "score_composite DESC NULLS LAST, name ASC"
                order_params = []

            cur.execute(f"""
                SELECT id, name, one_liner, description, website,
                       hq_city, country, sector, subsector, stage, employee_count,
                       founded, total_raised_usd, investors, verticals, tags,
                       is_hardware, is_software, score_composite, score_commercial,
                       score_technical, score_market_timing, score_partner_fit,
                       score_capital_eff, enrichment_status, scored_at,
                       env_4d, func_4d, stack_4d, biz_model_4d,
                       (SELECT COUNT(*) FROM cvc.partner_intros pi WHERE pi.company_id = id) AS intro_count,
                       (SELECT COALESCE(ARRAY_AGG(DISTINCT pi.partner_name ORDER BY pi.partner_name), ARRAY[]::text[]) FROM cvc.partner_intros pi WHERE pi.company_id = id) AS intro_partners,
                       (SELECT MAX(pi.intro_date) FROM cvc.partner_intros pi WHERE pi.company_id = id) AS last_intro_date,
                       is_portfolio, case_study, competitive_advantage
                FROM cvc.companies
                WHERE {where_clause}
                ORDER BY {order}
                LIMIT %s OFFSET %s
            """, params + order_params + [limit, offset])
            
            rows = cur.fetchall()
            return rows


@router.get("/sectors")
def get_sectors(user=Depends(require_auth)):
    """
    Returns distinct non-null sector values from cvc.companies ordered by count DESC.
    Used by CompanySearch and any other filter UI.
    Response: [{sector: str, count: int}]
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT sector, COUNT(*) as count
                FROM cvc.companies
                WHERE sector IS NOT NULL
                GROUP BY sector
                ORDER BY count DESC
            """)
            rows = cur.fetchall()
            return [{"sector": row["sector"], "count": row["count"]} for row in rows]


@router.delete("/{company_id}")
def delete_company(company_id: int, user=Depends(require_auth)):
    """Hard-delete a company and all related records."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name FROM cvc.companies WHERE id = %s", [company_id])
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Company not found")

            # Cascade-delete related tables first
            for table in [
                "cvc.company_robotics",
                "cvc.funding_rounds",
                "cvc.company_lifecycle",
                "cvc.dd_evaluations",
            ]:
                cur.execute(f"DELETE FROM {table} WHERE company_id = %s", [company_id])

            cur.execute("DELETE FROM cvc.companies WHERE id = %s", [company_id])
            conn.commit()
            return {"deleted": True, "id": company_id, "name": row["name"]}


@router.patch("/{company_id}")
def update_company(company_id: int, payload: CompanyUpdate, user=Depends(require_auth)):
    """Partial update of a company's editable fields, with activity log tracking."""
    list_fields = {"investors", "tags", "protocol_support", "verified_certs"}
    json_fields = {"commercial_signals"}

    with get_connection() as conn:
        with conn.cursor() as cur:
            # Fetch current values for changed-field comparison
            cur.execute("""
                SELECT name, one_liner, description, website, linkedin_url,
                       sector, stage, hq_city, country, founded, employee_count,
                       total_raised_usd, investors, tags, env_4d, func_4d, stack_4d,
                       biz_model_4d, background, competitive_advantage, case_study,
                       industrial_readiness_score, sovereignty_score, protocol_support,
                       verified_certs, deployment_signal_level, integration_notes,
                       score_composite, score_commercial, score_technical,
                       score_market_timing, score_partner_fit, score_capital_eff,
                       commercial_signals,
                       revenue_arr_usd, revenue_period, revenue_source
                FROM cvc.companies WHERE id = %s
            """, [company_id])
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Company not found")

            current = dict(row)
            changed_by = user.get("username") or "system"
            updates = {}
            log_entries = []

            for field, new_val in payload.model_dump(exclude_none=True).items():
                old_val = current.get(field)
                # Normalise for comparison
                if field in list_fields:
                    old_norm = sorted(old_val or [])
                    new_norm = sorted(new_val or [])
                    changed = old_norm != new_norm
                    old_str = json.dumps(old_val or [])
                    new_str = json.dumps(new_val or [])
                elif field in json_fields:
                    changed = (old_val or {}) != (new_val or {})
                    old_str = json.dumps(old_val) if old_val is not None else None
                    new_str = json.dumps(new_val) if new_val is not None else None
                else:
                    changed = str(old_val) != str(new_val) if old_val is not None else new_val is not None
                    old_str = str(old_val) if old_val is not None else None
                    new_str = str(new_val) if new_val is not None else None

                if changed:
                    updates[field] = json.dumps(new_val) if field in json_fields else new_val
                    log_entries.append((company_id, changed_by, field, old_str, new_str))

            # Auto-stamp sector review when analyst touches sector fields
            sector_review_fields = {"sector", "secondary_sector", "sector_confidence", "sector_rationale"}
            if updates and sector_review_fields.intersection(updates.keys()):
                updates["sector_reviewed_by"] = changed_by
                updates["sector_reviewed_at"] = datetime.now(timezone.utc).isoformat()

            if updates:
                set_clause = ", ".join(
                    f"{f} = %s::jsonb" if f in json_fields else f"{f} = %s"
                    for f in updates
                )
                values = list(updates.values()) + [company_id]
                cur.execute(f"UPDATE cvc.companies SET {set_clause} WHERE id = %s", values)

                for (cid, by, fname, oval, nval) in log_entries:
                    cur.execute("""
                        INSERT INTO cvc.company_activity_log
                            (company_id, changed_by, field_name, old_value, new_value, change_source)
                        VALUES (%s, %s, %s, %s, %s, 'manual')
                    """, [cid, by, fname, oval, nval])

            conn.commit()

    # Return full updated profile (reuse get_company logic)
    return get_company(company_id, user=user)


@router.get("/{company_id}/activity")
def get_company_activity(company_id: int, user=Depends(require_auth)):
    """Returns last 100 field-change log entries for a company."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM cvc.companies WHERE id = %s", [company_id])
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Company not found")
            cur.execute("""
                SELECT id, company_id, changed_by, changed_at, field_name,
                       old_value, new_value, change_source
                FROM cvc.company_activity_log
                WHERE company_id = %s
                ORDER BY changed_at DESC
                LIMIT 100
            """, [company_id])
            rows = cur.fetchall()
            return [dict(r) for r in rows]


@router.get("/{company_id}/announcements")
def get_company_announcements(company_id: int, user=Depends(require_auth)):
    """Returns all portco announcements for a company, newest first."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, title, body, announcement_type, is_public,
                       source_url, announced_date, added_by, created_at
                FROM cvc.portco_announcements
                WHERE company_id = %s
                ORDER BY COALESCE(announced_date, created_at::date) DESC, created_at DESC
            """, [company_id])
            rows = cur.fetchall()
            return [{
                "id":                r["id"],
                "title":             r["title"],
                "body":              r["body"],
                "announcement_type": r["announcement_type"],
                "is_public":         r["is_public"],
                "source_url":        r["source_url"],
                "announced_date":    str(r["announced_date"]) if r["announced_date"] else None,
                "added_by":          r["added_by"],
                "created_at":        r["created_at"].isoformat(),
            } for r in rows]


INTEL_DIR = "/home/nathan11/intel"


@router.get("/{company_id}/intel")
def get_company_intel(company_id: int, user=Depends(require_auth)):
    """List all intel items uploaded for a company."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM cvc.companies WHERE id = %s", [company_id])
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Company not found")
            cur.execute("""
                SELECT id, intel_type, label, source_url, file_name,
                       raw_text, uploaded_by, uploaded_at, processed, intent, signals
                FROM cvc.company_intel
                WHERE company_id = %s
                ORDER BY uploaded_at DESC
            """, [company_id])
            return [dict(r) for r in cur.fetchall()]


@router.post("/{company_id}/intel")
async def add_company_intel(
    company_id: int,
    intel_type: str = Form(...),
    label: Optional[str] = Form(None),
    source_url: Optional[str] = Form(None),
    raw_text: Optional[str] = Form(None),
    intent: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    user=Depends(require_auth),
):
    """Upload intel for a company. Accepts pdf file, url, or pasted text."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM cvc.companies WHERE id = %s", [company_id])
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Company not found")

    username = user.get("username", "analyst") if isinstance(user, dict) else str(user)

    if intel_type not in ("pdf", "url", "text"):
        raise HTTPException(status_code=400, detail="intel_type must be pdf, url, or text")

    extracted_text = None
    file_path = None
    file_name = None

    if intel_type == "pdf":
        if not file:
            raise HTTPException(status_code=400, detail="File required for pdf type")
        content = await file.read()
        file_name = file.filename or "upload.pdf"
        dest_dir = os.path.join(INTEL_DIR, str(company_id))
        os.makedirs(dest_dir, exist_ok=True)
        file_path = os.path.join(dest_dir, file_name)
        with open(file_path, "wb") as fh:
            fh.write(content)
        try:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(content)) as pdf:
                pages = [p.extract_text() or "" for p in pdf.pages]
            extracted_text = "\n\n".join(p for p in pages if p.strip())
        except Exception:
            extracted_text = None

    elif intel_type == "url":
        if not source_url:
            raise HTTPException(status_code=400, detail="source_url required for url type")
        try:
            resp = requests.get(
                source_url,
                headers={"User-Agent": "Mozilla/5.0 (compatible; CVCBot/1.0; research)"},
                timeout=15,
                allow_redirects=True,
            )
            resp.raise_for_status()
            html = resp.text
            html = re.sub(r"<script[^>]*>.*?</script>", " ", html, flags=re.DOTALL | re.IGNORECASE)
            html = re.sub(r"<style[^>]*>.*?</style>",  " ", html, flags=re.DOTALL | re.IGNORECASE)
            html = re.sub(r"<[^>]+>", " ", html)
            html = re.sub(r"&[a-z]+;", " ", html)
            extracted_text = re.sub(r"\s+", " ", html).strip()[:20000]
        except Exception:
            extracted_text = None

    elif intel_type == "text":
        if not raw_text:
            raise HTTPException(status_code=400, detail="raw_text required for text type")
        if not source_url:
            raise HTTPException(
                status_code=400,
                detail="source_url is required for pasted text intel — paste the article or post URL so verification can be run"
            )
        extracted_text = raw_text

    # Parse intent array from JSON string (e.g. '["funding","team"]')
    intent_list: list = []
    if intent:
        try:
            parsed = json.loads(intent)
            if isinstance(parsed, list):
                intent_list = [str(x) for x in parsed]
        except (json.JSONDecodeError, TypeError):
            pass

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO cvc.company_intel
                    (company_id, intel_type, label, source_url, file_path, file_name,
                     raw_text, uploaded_by, intent)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, [company_id, intel_type, label, source_url, file_path, file_name,
                  extracted_text, username, intent_list])
            intel_id = cur.fetchone()["id"]
            intent_str = ", ".join(intent_list) if intent_list else "general"
            note = label or (source_url[:60] if source_url else intel_type)
            _log_activity(cur, company_id, username, "intel_uploaded",
                          None, f"{intel_type} — {note} [{intent_str}]",
                          source="intel_upload")
        conn.commit()

    return {"id": intel_id, "company_id": company_id, "intel_type": intel_type,
            "intent": intent_list, "extracted": extracted_text is not None}


class IntelUpdate(BaseModel):
    source_url: Optional[str] = None
    label: Optional[str] = None


@router.patch("/{company_id}/intel/{intel_id}")
def update_company_intel(company_id: int, intel_id: int, body: IntelUpdate, user=Depends(require_auth)):
    """Update source_url or label on an existing intel item."""
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    with get_connection() as conn:
        with conn.cursor() as cur:
            set_clause = ", ".join(f"{k} = %s" for k in updates)
            cur.execute(
                f"UPDATE cvc.company_intel SET {set_clause} WHERE id = %s AND company_id = %s RETURNING id",
                [*updates.values(), intel_id, company_id]
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Intel item not found")
        conn.commit()
    return {"updated": True}


@router.delete("/{company_id}/intel/{intel_id}")
def delete_company_intel(company_id: int, intel_id: int, user=Depends(require_auth)):
    """Delete an intel item."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM cvc.company_intel WHERE id = %s AND company_id = %s RETURNING id",
                [intel_id, company_id]
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Intel item not found")
        conn.commit()
    return {"deleted": True}


@router.get("/{company_id}")
def get_company(company_id: int, user=Depends(require_auth)):
    """Get single company detail."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, name, one_liner, description, website,
                       hq_city, country, sector, subsector, stage, employee_count,
                       founded, total_raised_usd, investors, verticals, tags,
                       is_hardware, is_software, score_composite, score_commercial,
                       score_technical, score_market_timing, score_partner_fit,
                       score_capital_eff, enrichment_status, scored_at,
                       env_4d, func_4d, stack_4d, biz_model_4d,
                       predicted_subsector, business_model,
                       (SELECT COUNT(*) FROM cvc.partner_intros pi WHERE pi.company_id = id) AS intro_count,
                       (SELECT COALESCE(ARRAY_AGG(DISTINCT pi.partner_name ORDER BY pi.partner_name), ARRAY[]::text[]) FROM cvc.partner_intros pi WHERE pi.company_id = id) AS intro_partners,
                       (SELECT MAX(pi.intro_date) FROM cvc.partner_intros pi WHERE pi.company_id = id) AS last_intro_date,
                       is_portfolio, fund, case_study, competitive_advantage, background,
                       latest_investment_date, linkedin_url,
                       industrial_readiness_score, sovereignty_score,
                       protocol_support, deployment_signal_level,
                       verified_certs, integration_notes,
                       investor_tier, lead_investors, commercial_signals,
                       scoring_data,
                       news_articles, case_studies,
                       phase2_enriched_at, enrichment_source, score_updated_at, updated_at,
                       founders, is_repeat_founder, prior_exit_count,
                       secondary_sector, sector_confidence, sector_rationale,
                       sector_reviewed_by, sector_reviewed_at,
                       revenue_arr_usd, revenue_period, revenue_source
                FROM cvc.companies
                WHERE id = %s
            """, [company_id])

            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Company not found")

            result = dict(row)

            # Funding rounds from relational table (authoritative); fall back to
            # scoring_data JSONB for companies not yet backfilled
            cur.execute("""
                SELECT id, round_type, amount_usd, announced_date,
                       investors, source, approximate, valuation_usd, notes
                FROM cvc.funding_rounds
                WHERE company_id = %s
                ORDER BY announced_date ASC NULLS LAST, id ASC
            """, [company_id])
            relational_rounds = cur.fetchall()

            if relational_rounds:
                funding_rounds = [
                    {
                        "id":             r["id"],
                        "round_type":     r["round_type"],
                        "amount_usd":     r["amount_usd"],
                        "announced_date": str(r["announced_date"]) if r["announced_date"] else None,
                        "investors":      r["investors"] or [],
                        "source":         r["source"],
                        "approximate":    r["approximate"],
                        "valuation_usd":  int(r["valuation_usd"]) if r["valuation_usd"] else None,
                        "notes":          r["notes"],
                    }
                    for r in relational_rounds
                ]
            else:
                # Legacy fallback: scoring_data JSONB
                sd = (result.get("scoring_data") or {})
                raw_rounds = (sd.get("funding") or {}).get("funding_rounds") or []
                funding_rounds = [
                    {
                        "id":             None,
                        "round_type":     r.get("round_type"),
                        "amount_usd":     r.get("amount_usd"),
                        "announced_date": r.get("announced_date"),
                        "investors":      [],
                        "source":         None,
                        "approximate":    r.get("approximate", True),
                        "notes":          "Legacy enrichment snapshot",
                    }
                    for r in raw_rounds
                ]

            result["funding_rounds"] = funding_rounds
            del result["scoring_data"]

            # Term sheet / CVC position data
            cur.execute("""
                SELECT investment_type, round_type, check_size_usd,
                       pre_money_valuation_usd, post_money_valuation_usd,
                       round_size_usd, shares_purchased, pps_usd,
                       stage_at_investment, lead_investor, revenue_at_investment_usd,
                       fmv_usd, moic, fund, category_2,
                       is_lead_investor, co_investors, board_seat, pro_rata_rights,
                       close_date, lead_attorney, notes
                FROM cvc.term_sheets
                WHERE company_id = %s
                ORDER BY close_date DESC NULLS LAST
            """, [company_id])
            ts_rows = cur.fetchall()
            # Expose all positions; keep term_sheet as the primary (most recent) for backward compat
            result["term_sheets"] = [dict(r) for r in ts_rows]
            result["term_sheet"] = dict(ts_rows[0]) if ts_rows else None

            # Pending intel suggestions
            cur.execute("""
                SELECT s.id, s.suggestion_type, s.field_name,
                       s.current_value, s.suggested_value, s.suggested_data,
                       s.confidence, s.reasoning, s.created_at,
                       ci.label AS intel_label, ci.source_url AS intel_url
                FROM cvc.intel_suggestions s
                LEFT JOIN cvc.company_intel ci ON ci.id = s.intel_id
                WHERE s.company_id = %s AND s.status = 'pending'
                ORDER BY s.confidence DESC, s.created_at DESC
            """, [company_id])
            result["pending_suggestions"] = [dict(r) for r in cur.fetchall()]

            # Fetch robotics data if it exists
            cur.execute("""
                SELECT form_factor, application, deployment_stage,
                       payload_kg, task_success_rate, uptime_pct
                FROM cvc.company_robotics
                WHERE company_id = %s
            """, [company_id])
            robotics_row = cur.fetchone()
            result["robotics"] = dict(robotics_row) if robotics_row else None

            return result


# ── Intel suggestion endpoints ────────────────────────────────────────────────

FIELD_APPLY_MAP = {
    "stage":          "stage",
    "one_liner":      "one_liner",
    "hq_city":        "hq_city",
    "country":        "country",
    "employee_count": "employee_count",
    "website":        "website",
}


@router.post("/{company_id}/suggestions/{suggestion_id}/accept",
             dependencies=[Depends(require_auth)])
def accept_suggestion(company_id: int, suggestion_id: int,
                      user=Depends(require_auth)):
    action_note = None
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT * FROM cvc.intel_suggestions
                WHERE id = %s AND company_id = %s AND status = 'pending'
            """, (suggestion_id, company_id))
            s = cur.fetchone()
            if not s:
                raise HTTPException(status_code=404, detail="Suggestion not found or already reviewed")

            stype = s["suggestion_type"]

            if stype == "field_update" and s["field_name"] in FIELD_APPLY_MAP:
                col = FIELD_APPLY_MAP[s["field_name"]]
                cur.execute(
                    f"UPDATE cvc.companies SET {col} = %s WHERE id = %s",
                    (s["suggested_value"], company_id),
                )

            elif stype == "new_investor":
                investor_name = (s.get("suggested_value") or
                                 (s.get("suggested_data") or {}).get("investor_name"))
                if investor_name:
                    cur.execute("""
                        UPDATE cvc.companies
                        SET investors = array_append(
                            COALESCE(investors, ARRAY[]::text[]), %s
                        )
                        WHERE id = %s
                          AND NOT (%s = ANY(COALESCE(investors, ARRAY[]::text[])))
                    """, (investor_name, company_id, investor_name))

            elif stype == "new_funding_round" and s["suggested_data"]:
                d = s["suggested_data"]
                # Collect all source URLs from this suggestion
                all_sources = []
                if d.get("source_url"):
                    all_sources.append(d["source_url"])
                for u in (d.get("sources") or []):
                    if u and u not in all_sources:
                        all_sources.append(u)

                # Check if this round already exists for this company
                cur.execute("""
                    SELECT id, source, notes FROM cvc.funding_rounds
                    WHERE company_id = %s AND round_type = %s
                    LIMIT 1
                """, (company_id, d.get("round_type")))
                existing = cur.fetchone()

                if existing:
                    # Round exists — attach any new source URLs as additional confirmation
                    if all_sources:
                        new_lines = [f"Source: {u}" for u in all_sources]
                        new_notes = "\n".join(filter(None, [existing["notes"]] + new_lines))
                        cur.execute("""
                            UPDATE cvc.funding_rounds
                            SET source = COALESCE(source, %s),
                                notes = %s
                            WHERE id = %s
                        """, (all_sources[0], new_notes, existing["id"]))
                    action_note = f"source_attached:{d.get('round_type')}"
                else:
                    cur.execute("""
                        INSERT INTO cvc.funding_rounds
                            (company_id, round_type, amount_usd, announced_date,
                             investors, source, approximate, notes)
                        VALUES (%s, %s, %s, %s, %s, %s, FALSE, %s)
                    """, (
                        company_id,
                        d.get("round_type"),
                        d.get("amount_usd"),
                        d.get("announced_date"),
                        d.get("investors") or [],
                        all_sources[0] if all_sources else None,
                        f"Accepted from intel suggestion #{suggestion_id}",
                    ))
                # Also write to trend_report.funding_events if sector is known
                cur.execute("SELECT sector FROM cvc.companies WHERE id = %s", (company_id,))
                co = cur.fetchone()
                if co and co["sector"] and d.get("amount_usd"):
                    from datetime import datetime
                    q = f"{datetime.now().year}-Q{(datetime.now().month-1)//3+1}"
                    cur.execute("""
                        INSERT INTO trend_report.funding_events
                            (company_name, company_id, round_type, amount_usd,
                             investors, event_date, source_url, sector_tags, quarter)
                        SELECT name, %s, %s, %s, %s, %s, %s, ARRAY[LOWER(REPLACE(sector,' ','_'))], %s
                        FROM cvc.companies WHERE id = %s
                        ON CONFLICT DO NOTHING
                    """, (
                        company_id,
                        d.get("round_type"),
                        d.get("amount_usd"),
                        d.get("investors") or [],
                        d.get("announced_date"),
                        d.get("source_url"),
                        q,
                        company_id,
                    ))

            elif stype == "case_study" and s["suggested_data"]:
                # Brave Search sourced case study (from enrich_cases.py)
                d = s["suggested_data"]
                entry = {
                    "title":   d.get("title") or "",
                    "url":     d.get("url") or "",
                    "snippet": d.get("snippet") or "",
                    "age":     d.get("age") or None,
                }
                if entry["title"] or entry["url"]:
                    cur.execute("""
                        UPDATE cvc.companies
                        SET case_studies = COALESCE(case_studies, '[]'::jsonb) || %s::jsonb
                        WHERE id = %s
                    """, (json.dumps([entry]), company_id))

            elif stype == "new_case_study" and s["suggested_data"]:
                d = s["suggested_data"]
                # Append to companies.case_studies jsonb array
                entry = {
                    "title":   d.get("title") or "",
                    "url":     (d.get("sources") or [None])[0],
                    "snippet": d.get("snippet") or "",
                    "age":     None,
                }
                cur.execute("""
                    UPDATE cvc.companies
                    SET case_studies = COALESCE(case_studies, '[]'::jsonb) || %s::jsonb
                    WHERE id = %s
                """, (json.dumps([entry]), company_id))

            elif stype == "new_commercial_deployment" and s["suggested_data"]:
                d = s["suggested_data"]
                source_note = ", ".join(d.get("sources") or []) or None
                notes = d.get("notes") or ""
                if source_note:
                    notes = f"{notes}\nSources: {source_note}".strip()
                cur.execute("""
                    INSERT INTO cvc.commercial_deployments
                        (company_id, customer_name, deployment_type, contract_value_usd,
                         start_date, stealth, notes, added_by)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    company_id,
                    d.get("customer_name") or "Undisclosed",
                    d.get("deployment_type") or "Commercial Deployment",
                    d.get("contract_value_usd"),
                    d.get("start_date"),
                    bool(d.get("stealth", False)),
                    notes or None,
                    user.get("username") or "system",
                ))

            # Mark accepted
            cur.execute("""
                UPDATE cvc.intel_suggestions
                SET status = 'accepted',
                    reviewed_by = %s,
                    reviewed_at = NOW()
                WHERE id = %s
            """, (user.get("username") or "system", suggestion_id))
            conn.commit()

    return {"accepted": True, "suggestion_id": suggestion_id, "action_note": action_note}


@router.post("/{company_id}/suggestions/{suggestion_id}/reject",
             dependencies=[Depends(require_auth)])
def reject_suggestion(company_id: int, suggestion_id: int,
                      user=Depends(require_auth)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE cvc.intel_suggestions
                SET status = 'rejected',
                    reviewed_by = %s,
                    reviewed_at = NOW()
                WHERE id = %s AND company_id = %s AND status = 'pending'
                RETURNING id
            """, (user.get("username") or "system", suggestion_id, company_id))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Suggestion not found or already reviewed")
            conn.commit()
    return {"rejected": True, "suggestion_id": suggestion_id}


@router.patch("/{company_id}/suggestions/{suggestion_id}",
              dependencies=[Depends(require_auth)])
def edit_suggestion(company_id: int, suggestion_id: int, data: dict,
                    user=Depends(require_auth)):
    """Update the suggested_data fields of a pending suggestion before accepting."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT suggested_data FROM cvc.intel_suggestions
                WHERE id = %s AND company_id = %s AND status = 'pending'
            """, (suggestion_id, company_id))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Suggestion not found or not pending")

            merged = {**(row["suggested_data"] or {}), **data}

            cur.execute("""
                UPDATE cvc.intel_suggestions
                SET suggested_data = %s
                WHERE id = %s
            """, (json.dumps(merged), suggestion_id))
            conn.commit()
    return {"updated": True, "suggestion_id": suggestion_id}


@router.post("/{company_id}/intel/process",
             dependencies=[Depends(require_auth)])
def trigger_intel_processing(company_id: int):
    """Manually trigger intel processing for a specific company."""
    import subprocess, sys
    try:
        proc = subprocess.Popen(
            [sys.executable, "workers/enrichment/process_intel.py"],
            cwd="/home/nathan11/repos/cvc-intelligence",
            env={**os.environ, "PYTHONPATH": "/home/nathan11/repos/cvc-intelligence/core"},
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return {"triggered": True, "pid": proc.pid}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class FundingRoundInput(BaseModel):
    round_type: str
    amount_usd: Optional[int] = None
    announced_date: Optional[str] = None
    investors: Optional[List[str]] = None
    source: Optional[str] = None
    valuation_usd: Optional[int] = None
    approximate: bool = False


@router.post("/{company_id}/funding-rounds/autofill", dependencies=[Depends(require_auth)])
def autofill_funding_round(company_id: int, body: dict, user=Depends(require_auth)):
    """Scrape a URL and extract funding round details via LLM."""
    url = (body.get("url") or "").strip()
    if not url or not url.startswith("http"):
        raise HTTPException(status_code=400, detail="Valid URL required")

    # Scrape
    import re as _re
    import html as _html_lib
    import requests as _req
    try:
        resp = _req.get(url, timeout=12,
                        headers={"User-Agent": "Mozilla/5.0 (compatible; CVCBot/1.0)"},
                        allow_redirects=True)
        raw = resp.text
    except Exception:
        raw = ""

    # Pull useful text from the page
    def _meta(pattern):
        m = _re.search(pattern, raw, _re.I | _re.S)
        return _html_lib.unescape(m.group(1).strip()) if m else ""

    title    = _meta(r'<title[^>]*>([^<]{1,200})</title>')
    og_desc  = _meta(r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\'](.*?)["\']')
    meta_desc = _meta(r'<meta[^>]+name=["\']description["\'][^>]+content=["\'](.*?)["\']')
    # Strip tags and grab first 3000 chars of body text
    body_text = _re.sub(r'<[^>]+>', ' ', raw)
    body_text = _re.sub(r'\s+', ' ', body_text).strip()[:3000]
    context = "\n".join(filter(None, [title, og_desc or meta_desc, body_text]))

    # LLM extraction
    try:
        from core.llm.openrouter import call as llm_call
    except ImportError:
        raise HTTPException(status_code=500, detail="LLM not available")
    _AUTOFILL_MODEL = "qwen/qwen3-235b-a22b-2507"

    prompt = f"""\
Extract funding round details from this webpage content.

URL: {url}
Content:
{context[:4000]}

Return ONLY valid JSON with these fields (omit any you cannot find):
{{
  "round_type": "e.g. Series A, Seed, Grant, SBIR",
  "amount_usd": 5000000,
  "valuation_usd": 20000000,
  "announced_date": "YYYY-MM-DD",
  "investors": ["Investor A", "Investor B"]
}}

Rules:
- amount_usd and valuation_usd must be integers (no commas, no $ sign)
- announced_date must be YYYY-MM-DD format or omit if unknown
- investors must be a list of strings
- If you cannot determine a field, omit it entirely
"""

    try:
        raw_response = llm_call(prompt, model=_AUTOFILL_MODEL, temperature=0.1,
                                max_tokens=512, timeout=30, activity="round_autofill")
        raw_response = raw_response.strip()
        if raw_response.startswith("```"):
            lines = raw_response.split("\n")
            raw_response = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
        result = json.loads(raw_response)
    except Exception:
        return {"round_type": None, "amount_usd": None, "valuation_usd": None,
                "announced_date": None, "investors": []}

    return {
        "round_type":    result.get("round_type") or None,
        "amount_usd":    result.get("amount_usd") or None,
        "valuation_usd": result.get("valuation_usd") or None,
        "announced_date": result.get("announced_date") or None,
        "investors":     result.get("investors") or [],
    }


@router.post("/{company_id}/funding-rounds", dependencies=[Depends(require_auth)])
def add_funding_round(company_id: int, data: FundingRoundInput, user=Depends(require_auth)):
    """Manually add a funding round directly to a company."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name, is_portfolio FROM cvc.companies WHERE id = %s", (company_id,))
            co = cur.fetchone()
            if not co:
                raise HTTPException(status_code=404, detail="Company not found")

            announced = None
            if data.announced_date:
                try:
                    from datetime import date
                    announced = date.fromisoformat(data.announced_date[:10])
                except Exception:
                    pass

            cur.execute("""
                INSERT INTO cvc.funding_rounds
                    (company_id, round_type, amount_usd, announced_date,
                     investors, source, valuation_usd, approximate)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                company_id, data.round_type, data.amount_usd, announced,
                data.investors or [], data.source, data.valuation_usd, data.approximate,
            ))
            round_id = cur.fetchone()["id"]
            username = user.get("username", "analyst") if isinstance(user, dict) else str(user)
            amt = f"${data.amount_usd:,}" if data.amount_usd else "undisclosed"
            _log_activity(cur, company_id, username, "funding_round_added",
                          None, f"{data.round_type} {amt}", source="funding_round")

            # Auto-announce large rounds for portfolio companies
            if data.amount_usd and data.amount_usd >= 10_000_000 and co["is_portfolio"]:
                amt_m = f"${data.amount_usd / 1_000_000:.0f}M"
                title = f"{co['name']} closes {amt_m} {data.round_type}"
                body = (
                    f"{co['name']} has raised {amt_m} in a {data.round_type} round"
                    + (f", valuing the company at ${data.valuation_usd / 1_000_000:.0f}M"
                       if data.valuation_usd else "")
                    + "."
                )
                cur.execute("""
                    INSERT INTO cvc.portco_announcements
                        (company_id, title, body, announcement_type, is_public, announced_date, added_by)
                    VALUES (%s, %s, %s, 'funding', FALSE, %s, 'system')
                """, (company_id, title, body, announced))

            conn.commit()
    return {"id": round_id, "company_id": company_id}


@router.patch("/{company_id}/funding-rounds/{round_id}", dependencies=[Depends(require_auth)])
def update_funding_round(company_id: int, round_id: int, data: dict, user=Depends(require_auth)):
    """Update editable fields on a funding round."""
    allowed = {"round_type", "amount_usd", "announced_date", "investors", "source", "valuation_usd", "approximate"}
    fields, vals = [], []
    for k, v in data.items():
        if k not in allowed:
            continue
        if k == "announced_date":
            if v:
                try:
                    from datetime import date as _date
                    v = _date.fromisoformat(str(v)[:10])
                except Exception:
                    continue
            else:
                v = None
        fields.append(f"{k} = %s")
        vals.append(v)
    if not fields:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    vals.extend([round_id, company_id])
    username = user.get("username") or "system"
    summary = ", ".join(f"{k}={v}" for k, v in data.items() if k in allowed)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE cvc.funding_rounds SET {', '.join(fields)} WHERE id = %s AND company_id = %s RETURNING id",
                vals
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Round not found")
            _log_activity(cur, company_id, username, "funding_round_updated",
                          None, summary[:200], source="funding_round")
            conn.commit()
    return {"updated": True, "round_id": round_id}


@router.delete("/{company_id}/funding-rounds/{round_id}", dependencies=[Depends(require_auth)])
def delete_funding_round(company_id: int, round_id: int, user=Depends(require_auth)):
    """Remove a funding round from a company."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM cvc.funding_rounds WHERE id = %s AND company_id = %s RETURNING id, round_type, amount_usd",
                (round_id, company_id)
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Round not found")
            username = user.get("username", "analyst") if isinstance(user, dict) else str(user)
            amt = f"${row['amount_usd']:,}" if row.get("amount_usd") else "undisclosed"
            _log_activity(cur, company_id, username, "funding_round_deleted",
                          f"{row['round_type']} {amt}", None, source="funding_round")
            conn.commit()
    return {"deleted": True, "round_id": round_id}


# ── Per-Company Enrichment Refresh ───────────────────────────────────────────

class RefreshEnrichmentBody(BaseModel):
    jobs: List[str]  # pipeline steps: "founder", "fourD", "funding", "cases", "industrial", "score"


@router.post("/{company_id}/refresh-enrichment")
def refresh_enrichment(company_id: int, body: RefreshEnrichmentBody, user=Depends(require_auth)):
    """
    Run selected enrichment pipeline steps for a single company.

    Steps (matching the 6-step pipeline):
    - founder:    Step 1 — founder_research.py → bios, exits → company_intel
    - fourD:      Step 2 — enrich_4d.py → 4D classification + news
    - funding:    Step 3 — enrich_funding_rounds.py → Brave Search → intel_suggestions (Human Review)
    - cases:      Step 4 — enrich_cases.py → case studies + revenue extraction
    - industrial: Step 5 — creates a BigClaw build task → enrich_industrial.py
    - score:      Step 6 — clears scored_at to queue this company for the nightly scoring run (3 AM)
    """
    import threading
    from pathlib import Path

    results = {}
    jobs = [j.lower() for j in (body.jobs or [])]

    repo_root = Path(__file__).resolve().parents[2]
    env_file = repo_root / ".env"

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name FROM cvc.companies WHERE id = %s", (company_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Company not found")
            company_name = row["name"]

            if "score" in jobs:
                cur.execute(
                    "UPDATE cvc.companies SET scored_at = NULL, score_updated_at = NULL WHERE id = %s",
                    (company_id,)
                )
                results["score"] = "queued for nightly run"

            if "industrial" in jobs:
                spec = (
                    f"Industrial Analysis — {company_name} (company_id={company_id}). "
                    f"Run enrich_industrial.py to score integration readiness, sovereignty, and friction. "
                    f"Requires steps 1–4 complete.\n"
                    f"Command: PYTHONPATH=core python3 workers/enrichment/enrich_industrial.py "
                    f'--company "{company_name}"'
                )
                cur.execute(
                    """INSERT INTO cvc.build_tasks (spec, priority, risk_level, requires_approval, status, created_by)
                       VALUES (%s, 'normal', 'low', FALSE, 'approved', %s)
                       RETURNING task_id""",
                    (spec, (user.get("username") or "system") if isinstance(user, dict) else "system")
                )
                task_row = cur.fetchone()
                results["industrial"] = f"task #{task_row['task_id']} queued"

            conn.commit()

    def _load_env(env_file):
        import os
        env = os.environ.copy()
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, _, v = line.partition('=')
                    env[k.strip()] = v.strip()
        return env

    def _run_script(script_path, args):
        import subprocess
        env = _load_env(env_file)
        env["PYTHONPATH"] = str(repo_root / "core")
        subprocess.run(
            ["python3", str(script_path)] + args,
            env=env, cwd=str(repo_root), capture_output=True
        )

    def _run_and_notify(script_path, args, notif_title):
        _run_script(script_path, args)
        try:
            with get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO cvc.notifications
                            (type, title, source, link, reference_id)
                        VALUES ('enrichment', %s, 'enrich_worker', %s, %s)
                    """, (notif_title, f"/company/{company_id}", company_id))
                conn.commit()
        except Exception:
            pass

    if "founder" in jobs:
        founder_script = repo_root / "workers" / "enrichment" / "founder_research.py"
        threading.Thread(
            target=_run_and_notify,
            args=(founder_script, [f"--company-id={company_id}"],
                  f"Founder Research complete — {company_name}"),
            daemon=True
        ).start()
        results["founder"] = "running"

    if "fourd" in jobs:
        threading.Thread(
            target=_run_and_notify,
            args=(repo_root / "workers" / "enrichment" / "enrich_4d.py",
                  ["--id", str(company_id), "--no-gate"],
                  f"4D Classification complete — {company_name}"),
            daemon=True
        ).start()
        results["fourD"] = "running"

    if "cases" in jobs:
        threading.Thread(
            target=_run_and_notify,
            args=(repo_root / "workers" / "enrichment" / "enrich_cases.py",
                  ["--id", str(company_id), "--no-gate"],
                  f"Case Studies & Deployments complete — {company_name}"),
            daemon=True
        ).start()
        results["cases"] = "running"

    if "funding" in jobs:
        funding_script = repo_root / "workers" / "enrichment" / "enrich_funding_rounds.py"
        threading.Thread(
            target=_run_and_notify,
            args=(funding_script, [f"--company-id={company_id}", "--batch"],
                  f"Funding Rounds enrichment complete — {company_name}"),
            daemon=True
        ).start()
        results["funding"] = "running"

    return {"company_id": company_id, "company": company_name, "jobs": results}


# ── Commercial Deployments ────────────────────────────────────────────────────

class CommercialDeploymentInput(BaseModel):
    customer_name: Optional[str] = None
    deployment_type: str
    contract_value_usd: Optional[int] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    stealth: bool = False
    notes: Optional[str] = None
    source_url: Optional[str] = None


class CommercialDeploymentUpdate(BaseModel):
    customer_name: Optional[str] = None
    deployment_type: Optional[str] = None
    contract_value_usd: Optional[int] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    stealth: Optional[bool] = None
    notes: Optional[str] = None
    source_url: Optional[str] = None


@router.get("/{company_id}/commercial-deployments")
def get_commercial_deployments(company_id: int, user=Depends(require_auth)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, customer_name, deployment_type, contract_value_usd,
                       start_date, end_date, stealth, notes, source_url, added_by, created_at
                FROM cvc.commercial_deployments
                WHERE company_id = %s
                ORDER BY start_date ASC NULLS LAST, created_at ASC
            """, (company_id,))
            rows = cur.fetchall()
    return [
        {
            "id":                  r["id"],
            "customer_name":       r["customer_name"],
            "deployment_type":     r["deployment_type"],
            "contract_value_usd":  r["contract_value_usd"],
            "start_date":          r["start_date"].isoformat() if r["start_date"] else None,
            "end_date":            r["end_date"].isoformat() if r["end_date"] else None,
            "stealth":             r["stealth"],
            "notes":               r["notes"],
            "source_url":          r["source_url"],
            "added_by":            r["added_by"],
            "created_at":          r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]


@router.post("/{company_id}/commercial-deployments")
def add_commercial_deployment(company_id: int, body: CommercialDeploymentInput, user=Depends(require_auth)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            username = user.get("username", "analyst") if isinstance(user, dict) else str(user)
            cur.execute("""
                INSERT INTO cvc.commercial_deployments
                    (company_id, customer_name, deployment_type, contract_value_usd,
                     start_date, end_date, stealth, notes, source_url, added_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                company_id, body.customer_name, body.deployment_type,
                body.contract_value_usd,
                body.start_date or None, body.end_date or None,
                body.stealth, body.notes, body.source_url, username
            ))
            new_id = cur.fetchone()["id"]
            val = f"${body.contract_value_usd:,}" if body.contract_value_usd else "undisclosed"
            customer = body.customer_name if not body.stealth else "[stealth]"
            _log_activity(cur, company_id, username, "commercial_deployment_added",
                          None, f"{body.deployment_type} — {customer} {val}",
                          source="commercial_deployment")
            conn.commit()
    return {"created": True, "id": new_id}


@router.patch("/{company_id}/commercial-deployments/{dep_id}")
def update_commercial_deployment(company_id: int, dep_id: int, body: CommercialDeploymentUpdate, user=Depends(require_auth)):
    fields = {k: v for k, v in body.dict().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    # handle explicit stealth=False
    if body.stealth is not None:
        fields['stealth'] = body.stealth
    set_clause = ", ".join(f"{k} = %s" for k in fields)
    values = list(fields.values()) + [dep_id, company_id]
    username = user.get("username") or "system"
    summary = ", ".join(f"{k}={v}" for k, v in fields.items())
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE cvc.commercial_deployments SET {set_clause} WHERE id = %s AND company_id = %s RETURNING id",
                values
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Deployment not found")
            _log_activity(cur, company_id, username, "commercial_deployment_updated",
                          None, summary[:200], source="commercial_deployment")
            conn.commit()
    return {"updated": True, "id": dep_id}


@router.delete("/{company_id}/commercial-deployments/{dep_id}", dependencies=[Depends(require_auth)])
def delete_commercial_deployment(company_id: int, dep_id: int, user=Depends(require_auth)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM cvc.commercial_deployments WHERE id = %s AND company_id = %s RETURNING id, deployment_type, customer_name, stealth",
                (dep_id, company_id)
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Deployment not found")
            username = user.get("username", "analyst") if isinstance(user, dict) else str(user)
            customer = row["customer_name"] if not row["stealth"] else "[stealth]"
            _log_activity(cur, company_id, username, "commercial_deployment_deleted",
                          f"{row['deployment_type']} — {customer}", None,
                          source="commercial_deployment")
            conn.commit()
    return {"deleted": True, "id": dep_id}


@router.get("/{company_id}/intros")
def get_company_intros(company_id: int, user=Depends(require_auth)):
    """All partner introductions for a startup, newest first."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT pi.id, pi.partner_name, pi.partner_id, p.name AS matched_partner_name,
                       pi.intro_date, pi.delivered_date, pi.intro_type, pi.receiver
                FROM cvc.partner_intros pi
                LEFT JOIN cvc.partners p ON p.id = pi.partner_id
                WHERE pi.company_id = %s
                ORDER BY pi.intro_date DESC NULLS LAST
            """, (company_id,))
            return cur.fetchall()


# ── Company Contacts ──────────────────────────────────────────────────────────

class ContactCreate(BaseModel):
    name: str
    title: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    is_primary: bool = False

class ContactUpdate(BaseModel):
    name: Optional[str] = None
    title: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    is_primary: Optional[bool] = None

@router.get("/{company_id}/contacts")
def list_contacts(company_id: int, user=Depends(require_auth)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, name, title, email, phone, is_primary, added_by, created_at
                FROM cvc.company_contacts
                WHERE company_id = %s
                ORDER BY is_primary DESC, created_at ASC
            """, (company_id,))
            return cur.fetchall()

@router.post("/{company_id}/contacts")
def add_contact(company_id: int, payload: ContactCreate, user=Depends(require_auth)):
    username = user.get("username", "analyst") if isinstance(user, dict) else str(user)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO cvc.company_contacts (company_id, name, title, email, phone, is_primary, added_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id, name, title, email, phone, is_primary, added_by, created_at
            """, (company_id, payload.name, payload.title, payload.email, payload.phone, payload.is_primary, username))
            row = dict(cur.fetchone())
            conn.commit()
    return row

@router.patch("/{company_id}/contacts/{contact_id}")
def update_contact(company_id: int, contact_id: int, payload: ContactUpdate, user=Depends(require_auth)):
    fields = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    set_clause = ", ".join(f"{k} = %s" for k in fields)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE cvc.company_contacts SET {set_clause} WHERE id = %s AND company_id = %s RETURNING id",
                [*fields.values(), contact_id, company_id]
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Contact not found")
            conn.commit()
    return {"updated": True}

@router.delete("/{company_id}/contacts/{contact_id}")
def delete_contact(company_id: int, contact_id: int, user=Depends(require_auth)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM cvc.company_contacts WHERE id = %s AND company_id = %s RETURNING id",
                (contact_id, company_id)
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Contact not found")
            conn.commit()
    return {"deleted": True}
