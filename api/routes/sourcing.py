"""
api/routes/sourcing.py — Startup sourcing endpoint with advanced filters.

STAGE VALUES (exact): pre_seed, seed, series_a, series_b, series_c, series_d, undisclosed, n/a
"""
from fastapi import APIRouter, Query, Depends
from typing import Optional, List
from pydantic import BaseModel

from core.db.connection import get_connection
from api.auth import require_auth

router = APIRouter()


def _format_raised(amount: Optional[int]) -> Optional[str]:
    if not amount:
        return None
    if amount >= 1_000_000_000:
        return f"${amount / 1_000_000_000:.1f}B"
    if amount >= 1_000_000:
        return f"${amount / 1_000_000:.1f}M"
    return f"${amount:,}"


class SourcingCompany(BaseModel):
    id: int
    name: str
    sector: Optional[str] = None
    stage: Optional[str] = None
    location: Optional[str] = None
    raised: Optional[str] = None
    one_liner: Optional[str] = None
    description: Optional[str] = None
    signal_score: Optional[float] = None
    founded: Optional[int] = None
    total_raised_usd: Optional[int] = None
    is_hardware: Optional[bool] = None
    is_software: Optional[bool] = None
    subsector: Optional[str] = None
    intro_count: int = 0
    intro_partners: List[str] = []
    last_intro_date: Optional[str] = None
    has_case_study: bool = False
    investor_tier: Optional[str] = None
    is_portfolio: Optional[bool] = None
    fund: Optional[str] = None


@router.get("/")
async def list_sourcing_companies(
    q: Optional[str] = Query(None),
    sector: Optional[str] = Query(None),
    stage: Optional[str] = Query(None),
    subsector: Optional[str] = Query(None),
    is_hardware: Optional[bool] = Query(None),
    is_software: Optional[bool] = Query(None),
    founded_after: Optional[int] = Query(None),
    founded_before: Optional[int] = Query(None),
    raised_min: Optional[int] = Query(None),
    raised_max: Optional[int] = Query(None),
    min_intros: Optional[int] = Query(None, description="Minimum number of partner introductions"),
    has_case_study: Optional[bool] = Query(None, description="Only companies with a case study"),
    investor_tier: Optional[str] = Query(None, description="top_tier | mid_tier | emerging"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    user=Depends(require_auth)
):
    """
    Advanced company sourcing with filters for funding, founding year,
    hardware/software flags, and subsector.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            conditions = []
            params = []
            
            # Text search across name, one_liner, description
            if q:
                conditions.append("(name ILIKE %s OR one_liner ILIKE %s OR description ILIKE %s)")
                params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])
            
            # Sector filter
            if sector:
                conditions.append("sector = %s")
                params.append(sector)
            
            # Stage filter
            if stage:
                conditions.append("stage = %s")
                params.append(stage)
            
            # Subsector filter
            if subsector:
                conditions.append("subsector = %s")
                params.append(subsector)
            
            # Hardware/software flags
            if is_hardware is not None:
                conditions.append("is_hardware = %s")
                params.append(is_hardware)
            
            if is_software is not None:
                conditions.append("is_software = %s")
                params.append(is_software)
            
            # Founded year range
            if founded_after is not None:
                conditions.append("founded >= %s")
                params.append(founded_after)
            
            if founded_before is not None:
                conditions.append("founded <= %s")
                params.append(founded_before)
            
            # Funding range
            if raised_min is not None:
                conditions.append("total_raised_usd >= %s")
                params.append(raised_min)
            
            if raised_max is not None:
                conditions.append("total_raised_usd <= %s")
                params.append(raised_max)

            if min_intros is not None:
                conditions.append("(SELECT COUNT(*) FROM cvc.partner_intros pi WHERE pi.company_id = id) >= %s")
                params.append(min_intros)

            if has_case_study:
                conditions.append("case_study IS NOT NULL AND case_study != ''")

            if investor_tier:
                conditions.append("investor_tier = %s")
                params.append(investor_tier)

            # Build WHERE clause
            where_clause = "WHERE " + " AND ".join(conditions) if conditions else ""
            
            # Get total count for pagination
            count_query = f"SELECT COUNT(*) as total FROM cvc.companies {where_clause}"
            cur.execute(count_query, params)
            total = cur.fetchone()["total"]

            # Main query with all sourcing fields
            offset = (page - 1) * per_page
            if q:
                order_clause = """
                    CASE
                        WHEN name ILIKE %s THEN 0
                        WHEN name ILIKE %s THEN 1
                        ELSE 2
                    END,
                    score_composite DESC NULLS LAST, name
                """
                order_params = [f"{q}%", f"%{q}%"]
            else:
                order_clause = "score_composite DESC NULLS LAST, name"
                order_params = []

            query = f"""
                SELECT
                    id,
                    name,
                    sector,
                    stage,
                    hq_city,
                    country,
                    one_liner,
                    description,
                    score_composite as signal_score,
                    founded,
                    total_raised_usd,
                    is_hardware,
                    is_software,
                    subsector,
                    (SELECT COUNT(*) FROM cvc.partner_intros pi WHERE pi.company_id = id) AS intro_count,
                    (SELECT COALESCE(ARRAY_AGG(DISTINCT pi.partner_name ORDER BY pi.partner_name), ARRAY[]::text[]) FROM cvc.partner_intros pi WHERE pi.company_id = id) AS intro_partners,
                    last_intro_date,
                    (case_study IS NOT NULL AND case_study != '') AS has_case_study,
                    investor_tier,
                    is_portfolio,
                    fund
                FROM cvc.companies
                {where_clause}
                ORDER BY {order_clause}
                LIMIT %s OFFSET %s
            """
            cur.execute(query, params + order_params + [per_page, offset])
            rows = cur.fetchall()

            companies = []
            for r in rows:
                city, country = r["hq_city"], r["country"]
                location = f"{city}, {country}" if city and country else city or country or None
                companies.append(SourcingCompany(
                    id=r["id"],
                    name=r["name"],
                    sector=r["sector"],
                    stage=r["stage"],
                    location=location,
                    raised=_format_raised(r["total_raised_usd"]),
                    one_liner=r["one_liner"],
                    description=r["description"],
                    signal_score=r["signal_score"],
                    founded=r["founded"],
                    total_raised_usd=r["total_raised_usd"],
                    is_hardware=r["is_hardware"],
                    is_software=r["is_software"],
                    subsector=r["subsector"],
                    intro_count=r["intro_count"] or 0,
                    intro_partners=list(r["intro_partners"]) if r["intro_partners"] else [],
                    last_intro_date=str(r["last_intro_date"]) if r["last_intro_date"] else None,
                    has_case_study=bool(r["has_case_study"]),
                    investor_tier=r["investor_tier"],
                    is_portfolio=r["is_portfolio"],
                    fund=r["fund"],
                ))

            return {
                "companies": companies,
                "total": total,
                "page": page,
                "per_page": per_page,
            }
